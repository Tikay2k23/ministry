import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { queryRows, type Database, type Transaction } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import {
  careFollowups,
  formAnswerSets,
  formResponses,
  journalDays,
  journalEntries,
  journalEntryRevisions,
  people,
} from '../../db/schema';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { AppError, conflict, invalidState, notFound, validationError } from '../../errors';
import { assertCanAccessPerson } from '../../policy/can';
import type { StoredObject } from '../../storage/storage';
import { parseInput } from '../../validation';
import { assertProofPresent, attachProof, discardObjects, entryHasProof } from './proof.service';
import { recordAudit } from '../audit/audit.service';
import { splitBySensitivity, validateAnswers, type AnswerValue, type FieldDefinition } from '../forms/answers';
import { getFormVersion, getPublishedForm, JOURNAL_FORM_KEY, type FormVersionView } from '../forms/forms.service';
import { resolveEntryCode } from '../public/entry-codes.service';
import { requestLeaderChangeFromPublic } from '../public/participants.service';
import { participantContext, type ParticipantIdentity, type PublicRequest } from '../public/public-request';
import { assertRateLimit, RATE_LIMITS } from '../public/rate-limit';
import { getSetting } from '../settings/settings.service';
import { addDays, deadlineInstant, localDate, openJournalDates, timingFor } from './journal-dates';
import { ensureJournalLedger } from './ledger.service';

/**
 * Public journal submission (docs/05 W2–W4). Exactly one entry per person per journal date:
 * replays return the original receipt, a second submission is a conflict, and edits are
 * revisions allowed only from a remembered device before the deadline.
 */

const RETIRED_VERSION_GRACE_MS = 12 * 3_600_000;
const MAX_ANSWERS_BYTES = 60_000;

export interface JournalReceipt {
  journalDate: string;
  receivedAt: Date;
  timing: 'on_time' | 'late';
  revisionNo: number;
  leaderName: string | null;
  leaderChangeRequested: boolean;
}

const alreadySubmitted = (receivedAt: Date, canEdit: boolean) =>
  new AppError('CONFLICT', 'Your journal for this day was already received.', {
    meta: { reason: 'ALREADY_SUBMITTED', receivedAt: receivedAt.toISOString(), canEdit },
  });

async function activePerson(db: Database, personId: string) {
  const [person] = await db
    .select({ id: people.id, firstName: people.firstName, preferredName: people.preferredName, archivedAt: people.archivedAt })
    .from(people)
    .where(eq(people.id, personId));
  if (!person || person.archivedAt) throw new AppError('NOT_IDENTIFIED', 'Please identify yourself again.');
  return person;
}

async function leaderOf(db: Database, personId: string) {
  const [row] = await queryRows<{ id: string; first_name: string; last_name: string }>(
    db,
    sql`SELECT l.id, l.first_name, l.last_name FROM hierarchy_nodes n JOIN people l ON l.id = n.parent_person_id WHERE n.person_id = ${personId}::uuid`,
  );
  return row ? { id: row.id, name: `${row.first_name} ${row.last_name.charAt(0)}.` } : null;
}

async function acceptableVersion(db: Database, versionId: string, now: Date): Promise<FormVersionView> {
  const version = await getFormVersion(db, versionId);
  const usable =
    version &&
    version.formKey === JOURNAL_FORM_KEY &&
    (version.status === 'published' ||
      (version.status === 'retired' && version.retiredAt && now.getTime() - version.retiredAt.getTime() < RETIRED_VERSION_GRACE_MS));
  if (!usable) {
    throw invalidState('The journal questions were updated. Please reload the page — your answers will be kept where possible.', {
      reason: 'FORM_VERSION_RETIRED',
    });
  }
  return version;
}

function validate(fields: FieldDefinition[], answers: Record<string, unknown>) {
  if (JSON.stringify(answers).length > MAX_ANSWERS_BYTES) throw validationError({ _: ['Your journal is too long to send.'] });
  const outcome = validateAnswers(fields, answers);
  if (!outcome.ok) throw validationError(outcome.fieldErrors);
  return outcome.answers;
}

async function storeResponse(tx: Transaction, versionId: string, personId: string, fields: FieldDefinition[], answers: Record<string, AnswerValue>, now: Date) {
  const [response] = await tx
    .insert(formResponses)
    .values({ formVersionId: versionId, personId, submittedAt: now })
    .returning({ id: formResponses.id });
  const sets = splitBySensitivity(fields, answers);
  const rows = Object.entries(sets).map(([sensitivity, values]) => ({
    responseId: response!.id,
    sensitivity: sensitivity as FieldDefinition['sensitivity'],
    answers: values,
  }));
  if (rows.length) await tx.insert(formAnswerSets).values(rows);
  return response!.id;
}

/** Marks the ledger day received. Expected people already have a row; others (e.g. unconfirmed registrations) get one. */
async function recordDayForEntry(
  tx: Transaction,
  input: { personId: string; journalDate: string; entryId: string; status: 'submitted' | 'late'; reviewStatus: 'awaiting' | 'none' },
) {
  await tx.execute(sql`
    INSERT INTO journal_days (person_id, journal_date, is_expected, submission_status, review_status, entry_id,
                              leader_person_id, primary_leader_person_id, hierarchy_path)
    SELECT ${input.personId}::uuid, ${input.journalDate}::date, false, ${input.status}, ${input.reviewStatus}, ${input.entryId}::uuid,
           n.parent_person_id, n.primary_leader_person_id,
           coalesce((SELECT array_agg(c.ancestor_id ORDER BY c.depth DESC) FROM hierarchy_closure c
                      WHERE c.descendant_id = ${input.personId}::uuid AND c.depth > 0), '{}'::uuid[])
      FROM (SELECT 1) AS one
      LEFT JOIN hierarchy_nodes n ON n.person_id = ${input.personId}::uuid
    ON CONFLICT (person_id, journal_date) DO UPDATE SET
        submission_status = EXCLUDED.submission_status,
        review_status = EXCLUDED.review_status,
        entry_id = EXCLUDED.entry_id,
        excuse_reason = NULL,
        updated_at = now()`);
}

/** A journal ends an open "missed days" follow-up. */
async function resolveMissedStreakFollowUps(tx: Transaction, personId: string, now: Date) {
  await tx
    .update(careFollowups)
    .set({ status: 'resolved', resolutionNote: 'Journal received', resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(careFollowups.personId, personId),
        eq(careFollowups.kind, 'journal_missed_streak'),
        eq(careFollowups.status, 'open'),
      ),
    );
}

// ─── State for the journal page ───────────────────────────────────────────────

export async function getPublicJournalState(db: Database, identity: ParticipantIdentity, now: Date) {
  await ensureJournalLedger(db, now);
  const person = await activePerson(db, identity.personId);
  const [{ timezone }, policy, form, leader] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    getSetting(db, 'journal.policy'),
    getPublishedForm(db, JOURNAL_FORM_KEY),
    leaderOf(db, identity.personId),
  ]);
  if (!form) throw new AppError('INTERNAL', 'The journal is not set up yet.');

  const { today, yesterday } = openJournalDates(now, timezone, policy);
  const dates = [yesterday, today].filter((d): d is string => Boolean(d));
  const entries = await db
    .select({ journalDate: journalEntries.journalDate, receivedAt: journalEntries.firstSubmittedAt, revisionNo: journalEntries.revisionNo })
    .from(journalEntries)
    .where(and(eq(journalEntries.personId, identity.personId), inArray(journalEntries.journalDate, dates)));
  const canEditDate = (date: string) =>
    identity.persistent && policy.editWindow === 'until_deadline' && now <= deadlineInstant(date, timezone, policy);

  return {
    person: { firstName: person.preferredName ?? person.firstName },
    leader,
    timezone,
    /** Whether the page asks for a photo of the written journal, and whether it insists. */
    proofImage: policy.proofImage,
    form: { versionId: form.versionId, fields: form.fields },
    dates: dates.map((date) => {
      const entry = entries.find((e) => e.journalDate === date);
      return {
        date,
        label: date === today ? ('today' as const) : ('yesterday' as const),
        received: entry ? { at: entry.receivedAt, canEdit: canEditDate(date) } : null,
      };
    }),
  };
}

/** Prefill for editing — only for a remembered device, only while editing is allowed. */
export async function getOwnEntryForEdit(db: Database, identity: ParticipantIdentity, journalDate: string, now: Date) {
  if (!identity.persistent) return null;
  const [{ timezone }, policy] = await Promise.all([getSetting(db, 'ministry.profile'), getSetting(db, 'journal.policy')]);
  if (policy.editWindow !== 'until_deadline' || now > deadlineInstant(journalDate, timezone, policy)) return null;
  const [entry] = await db
    .select({ responseId: journalEntries.formResponseId })
    .from(journalEntries)
    .where(and(eq(journalEntries.personId, identity.personId), eq(journalEntries.journalDate, journalDate)));
  if (!entry) return null;
  const sets = await db.select().from(formAnswerSets).where(eq(formAnswerSets.responseId, entry.responseId));
  return Object.assign({}, ...sets.map((s) => s.answers as Record<string, AnswerValue>)) as Record<string, AnswerValue>;
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export const SubmitJournalInput = z.object({
  idempotencyKey: z.uuid(),
  formVersionId: z.uuid(),
  journalDate: z.iso.date(),
  answers: z.record(z.string(), z.unknown()),
  /** The photo of their written journal, uploaded a moment earlier (proof.service.ts). */
  attachmentId: z.uuid().optional(),
  /** The QR code the person came through, if any. */
  entryCode: z.string().trim().max(12).optional(),
  /** They confirmed the leader behind that QR code is their leader now. */
  requestLeaderChange: z.boolean().default(false),
});

export async function submitJournal(db: Database, identity: ParticipantIdentity, req: PublicRequest, raw: unknown): Promise<JournalReceipt> {
  const input = parseInput(SubmitJournalInput, raw);
  await assertRateLimit(db, `journal-submit:person:${identity.personId}`, RATE_LIMITS.submitPerPerson, req.now);
  await ensureJournalLedger(db, req.now);
  await activePerson(db, identity.personId);

  const [{ timezone }, policy, leader] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    getSetting(db, 'journal.policy'),
    leaderOf(db, identity.personId),
  ]);

  // Replaying the same submission (double tap, retry after a timeout) returns the original receipt.
  const [replay] = await db
    .select({ entry: journalEntries, revisionNo: journalEntryRevisions.revisionNo })
    .from(journalEntryRevisions)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryRevisions.entryId))
    .where(eq(journalEntryRevisions.idempotencyKey, input.idempotencyKey));
  if (replay && replay.entry.personId === identity.personId) {
    return {
      journalDate: replay.entry.journalDate,
      receivedAt: replay.entry.firstSubmittedAt,
      timing: replay.entry.timing,
      revisionNo: replay.revisionNo,
      leaderName: leader?.name ?? null,
      leaderChangeRequested: false,
    };
  }

  const { today, yesterday } = openJournalDates(req.now, timezone, policy);
  if (input.journalDate !== today && input.journalDate !== yesterday) {
    throw invalidState('That day is closed. Your journal will be saved for today instead — please send it again.', { reason: 'DAY_CLOSED', today });
  }

  const version = await acceptableVersion(db, input.formVersionId, req.now);
  const answers = validate(version.fields, input.answers);
  const code = input.entryCode ? await resolveEntryCode(db, input.entryCode) : null;
  const canEdit = identity.persistent && policy.editWindow === 'until_deadline' && req.now <= deadlineInstant(input.journalDate, timezone, policy);
  // Checked before the transaction so a member is told plainly, and again inside it by attaching
  // the photo in the same transaction as the journal: the two are saved together or not at all.
  assertProofPresent(policy, Boolean(input.attachmentId));

  // Files a replaced photo left behind, deleted after the transaction commits (storage cannot
  // take part in it, so the deletion waits until the journal is safely saved).
  let discarded: StoredObject[] = [];
  try {
    const receipt = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: journalEntries.id, receivedAt: journalEntries.firstSubmittedAt })
        .from(journalEntries)
        .where(and(eq(journalEntries.personId, identity.personId), eq(journalEntries.journalDate, input.journalDate)))
        .for('update');
      if (existing) throw alreadySubmitted(existing.receivedAt, canEdit);

      const timing = timingFor(input.journalDate, req.now, timezone, policy);
      const responseId = await storeResponse(tx, version.versionId, identity.personId, version.fields, answers, req.now);
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          personId: identity.personId,
          journalDate: input.journalDate,
          formResponseId: responseId,
          firstSubmittedAt: req.now,
          lastSubmittedAt: req.now,
          timing,
          channel: identity.channel,
          entryCodeId: code?.status === 'active' ? code.id : null,
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalEntryRevisions).values({
        entryId: entry!.id,
        revisionNo: 1,
        formResponseId: responseId,
        idempotencyKey: input.idempotencyKey,
        submittedAt: req.now,
      });

      if (input.attachmentId) {
        discarded = await attachProof(tx, { attachmentId: input.attachmentId, personId: identity.personId, entryId: entry!.id, now: req.now });
      }

      await recordDayForEntry(tx, {
        personId: identity.personId,
        journalDate: input.journalDate,
        entryId: entry!.id,
        status: timing === 'on_time' ? 'submitted' : 'late',
        reviewStatus: policy.reviewExpected ? 'awaiting' : 'none',
      });
      await resolveMissedStreakFollowUps(tx, identity.personId, req.now);

      let leaderChangeRequested = false;
      if (input.requestLeaderChange && code?.status === 'active' && code.leader?.placed && code.leader.personId !== leader?.id) {
        leaderChangeRequested = await requestLeaderChangeFromPublic(tx, identity.personId, code.leader.personId);
      }

      await recordAudit(tx, participantContext(req, identity.personId), {
        category: 'change',
        action: 'journal.submitted',
        entityType: 'journal_entry',
        entityId: entry!.id,
        newValues: { journalDate: input.journalDate, timing, channel: identity.channel, leaderChangeRequested },
      });
      return { journalDate: input.journalDate, receivedAt: req.now, timing, revisionNo: 1, leaderName: leader?.name ?? null, leaderChangeRequested };
    });
    await discardObjects(discarded);
    return receipt;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [winner] = await db
        .select({ receivedAt: journalEntries.firstSubmittedAt })
        .from(journalEntries)
        .where(and(eq(journalEntries.personId, identity.personId), eq(journalEntries.journalDate, input.journalDate)));
      throw alreadySubmitted(winner?.receivedAt ?? req.now, canEdit);
    }
    throw error;
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

export const EditJournalInput = z.object({
  idempotencyKey: z.uuid(),
  formVersionId: z.uuid(),
  journalDate: z.iso.date(),
  answers: z.record(z.string(), z.unknown()),
  /** A new photo. Leaving it out keeps the one already on the journal. */
  attachmentId: z.uuid().optional(),
});

export async function editJournal(db: Database, identity: ParticipantIdentity, req: PublicRequest, raw: unknown): Promise<JournalReceipt> {
  const input = parseInput(EditJournalInput, raw);
  await assertRateLimit(db, `journal-submit:person:${identity.personId}`, RATE_LIMITS.submitPerPerson, req.now);
  const [{ timezone }, policy, leader] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    getSetting(db, 'journal.policy'),
    leaderOf(db, identity.personId),
  ]);
  if (!identity.persistent || policy.editWindow !== 'until_deadline') {
    throw invalidState('Journals can only be edited from the phone you usually use.', { reason: 'EDIT_NOT_ALLOWED' });
  }

  const [replay] = await db
    .select({ entry: journalEntries, revisionNo: journalEntryRevisions.revisionNo })
    .from(journalEntryRevisions)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryRevisions.entryId))
    .where(eq(journalEntryRevisions.idempotencyKey, input.idempotencyKey));
  if (replay && replay.entry.personId === identity.personId) {
    return {
      journalDate: replay.entry.journalDate,
      receivedAt: replay.entry.lastSubmittedAt,
      timing: replay.entry.timing,
      revisionNo: replay.revisionNo,
      leaderName: leader?.name ?? null,
      leaderChangeRequested: false,
    };
  }

  if (req.now > deadlineInstant(input.journalDate, timezone, policy)) {
    throw invalidState('The time for editing this journal has passed.', { reason: 'EDIT_WINDOW_CLOSED' });
  }
  const version = await acceptableVersion(db, input.formVersionId, req.now);
  const answers = validate(version.fields, input.answers);

  let discarded: StoredObject[] = [];
  const receipt = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.personId, identity.personId), eq(journalEntries.journalDate, input.journalDate)))
      .for('update');
    if (!entry) throw new AppError('NOT_FOUND', 'There is no journal to edit for this day yet.');
    // An edit must not leave a journal without the photo the ministry requires: either one is
    // already on it, or this edit brings a new one.
    assertProofPresent(policy, Boolean(input.attachmentId) || (await entryHasProof(tx, entry.id)));
    if (input.attachmentId) {
      discarded = await attachProof(tx, { attachmentId: input.attachmentId, personId: identity.personId, entryId: entry.id, now: req.now });
    }
    const [dayRow] = await tx
      .select({ finalizedAt: journalDays.finalizedAt })
      .from(journalDays)
      .where(and(eq(journalDays.personId, identity.personId), eq(journalDays.journalDate, input.journalDate)));
    if (dayRow?.finalizedAt) throw invalidState('The time for editing this journal has passed.', { reason: 'EDIT_WINDOW_CLOSED' });

    const responseId = await storeResponse(tx, version.versionId, identity.personId, version.fields, answers, req.now);
    const revisionNo = entry.revisionNo + 1;
    await tx.insert(journalEntryRevisions).values({
      entryId: entry.id,
      revisionNo,
      formResponseId: responseId,
      idempotencyKey: input.idempotencyKey,
      submittedAt: req.now,
    });
    await tx
      .update(journalEntries)
      .set({ formResponseId: responseId, revisionNo, lastSubmittedAt: req.now })
      .where(eq(journalEntries.id, entry.id));
    if (policy.reviewExpected) {
      // Reviewed entries that change need another look.
      await tx
        .update(journalDays)
        .set({ reviewStatus: 'awaiting', updatedAt: req.now })
        .where(and(eq(journalDays.personId, identity.personId), eq(journalDays.journalDate, input.journalDate), isNull(journalDays.finalizedAt)));
    }
    await recordAudit(tx, participantContext(req, identity.personId), {
      category: 'change',
      action: 'journal.edited',
      entityType: 'journal_entry',
      entityId: entry.id,
      newValues: { journalDate: input.journalDate, revisionNo },
    });
    return {
      journalDate: input.journalDate,
      receivedAt: req.now,
      timing: entry.timing,
      revisionNo,
      leaderName: leader?.name ?? null,
      leaderChangeRequested: false,
    };
  });
  await discardObjects(discarded);
  return receipt;
}

// ─── Proxy submission (portal) ────────────────────────────────────────────────

const PROXY_LOOKBACK_DAYS = 7;

export const ProxyJournalInput = z.object({
  personId: z.uuid(),
  idempotencyKey: z.uuid(),
  formVersionId: z.uuid(),
  journalDate: z.iso.date(),
  answers: z.record(z.string(), z.unknown()),
});

/** A leader records a journal the person shared by phone, on paper or in person (FR-JRN-14). */
export async function submitJournalByProxy(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ProxyJournalInput, raw);
  await assertCanAccessPerson(db, ctx, 'journal.proxy_submit', input.personId);
  const userId = actorUserId(ctx);
  if (!userId || (ctx.actor.kind === 'user' && ctx.actor.personId === input.personId)) {
    throw invalidState('Please send your own journal from the journal page.');
  }
  await ensureJournalLedger(db, ctx.now);
  const [person] = await db.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, input.personId));
  if (!person || person.archivedAt) throw notFound('person');

  const [{ timezone }, policy] = await Promise.all([getSetting(db, 'ministry.profile'), getSetting(db, 'journal.policy')]);
  const today = localDate(ctx.now, timezone);
  if (input.journalDate > today || input.journalDate < addDays(today, -PROXY_LOOKBACK_DAYS)) {
    throw validationError({ journalDate: [`Choose a day within the last ${PROXY_LOOKBACK_DAYS} days.`] });
  }

  const [replay] = await db
    .select({ entryId: journalEntryRevisions.entryId, personId: journalEntries.personId, journalDate: journalEntries.journalDate })
    .from(journalEntryRevisions)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryRevisions.entryId))
    .where(eq(journalEntryRevisions.idempotencyKey, input.idempotencyKey));
  if (replay) {
    if (replay.personId !== input.personId) throw conflict('Please reload the page and try again.');
    return { entryId: replay.entryId, journalDate: replay.journalDate };
  }

  const version = await acceptableVersion(db, input.formVersionId, ctx.now);
  const answers = validate(version.fields, input.answers);
  const alreadyReceived = () => conflict('A journal was already received for this day.', { reason: 'ALREADY_SUBMITTED' });

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.personId, input.personId), eq(journalEntries.journalDate, input.journalDate)))
        .for('update');
      if (existing) throw alreadyReceived();

      const timing = timingFor(input.journalDate, ctx.now, timezone, policy);
      const responseId = await storeResponse(tx, version.versionId, input.personId, version.fields, answers, ctx.now);
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          personId: input.personId,
          journalDate: input.journalDate,
          formResponseId: responseId,
          firstSubmittedAt: ctx.now,
          lastSubmittedAt: ctx.now,
          timing,
          channel: 'proxy',
          proxyUserId: userId,
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalEntryRevisions).values({
        entryId: entry!.id,
        revisionNo: 1,
        formResponseId: responseId,
        idempotencyKey: input.idempotencyKey,
        submittedAt: ctx.now,
      });
      // The leader typed it in, so it doesn't wait in anyone's review queue.
      await recordDayForEntry(tx, {
        personId: input.personId,
        journalDate: input.journalDate,
        entryId: entry!.id,
        status: timing === 'on_time' ? 'submitted' : 'late',
        reviewStatus: 'none',
      });
      await resolveMissedStreakFollowUps(tx, input.personId, ctx.now);
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'journal.proxy_submitted',
        entityType: 'journal_entry',
        entityId: entry!.id,
        newValues: { personId: input.personId, journalDate: input.journalDate, timing },
      });
      return { entryId: entry!.id, journalDate: input.journalDate };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyReceived();
    throw error;
  }
}
