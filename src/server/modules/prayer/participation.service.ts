import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { formatSlotRange } from '@/lib/time-range';
import { sha256Hex } from '../../crypto';
import type { Database, Executor, Transaction } from '../../db/client';
import type { PrayerAssignmentStatus } from '../../db/enums';
import { actionTokens, formAnswerSets, formResponses, forms, people, prayerAssignments, prayerChains, prayerSlots } from '../../db/schema';
import { AppError, conflict, invalidState, notFound, validationError } from '../../errors';
import { parseInput } from '../../validation';
import { splitBySensitivity, validateAnswers, type FieldDefinition } from '../forms/answers';
import { getPublishedForm } from '../forms/forms.service';
import { queueNotification } from '../notifications/notifications.service';
import { recordAudit } from '../audit/audit.service';
import { addDays } from '../journal/journal-dates';
import { recordEntryCodeScan, resolveEntryCode } from '../public/entry-codes.service';
import { participantContext, type ParticipantIdentity, type PublicRequest } from '../public/public-request';
import { assertRateLimit, RATE_LIMITS } from '../public/rate-limit';
import { recordPrayerTokenUse, resolvePrayerActionToken, revokeAssignmentLinks } from './action-links.service';
import { todayCoverage } from './chains.service';
import { chainToday, closePrayerFollowUp, loadChain, recordPrayerEvent, type ChainRow } from './common';
import { HOLDS_PLACE, placeAssignment, type PlacementFailure } from './placement';
import { coordinatorUserIds } from './coordinators.service';
import { CANNOT_MAKE_IT_LABELS, CANNOT_MAKE_IT_REASONS } from './participant-options';
import { actionWindow, isLateCompletion, primaryAction, type AssignmentTiming } from './windows';

/**
 * What a participant sees and does without logging in (docs/04 P6–P7, docs/05 W12): their slot
 * through a personal action link (`/a/{token}`), or their slots on the chain page (`/pray/{code}`)
 * from a remembered device. Opening a page changes nothing; every action is a POST, so chat apps
 * that preview links can't confirm a slot by accident.
 */

const REPORT_MAX_BYTES = 30_000;
const MY_SLOTS_LIMIT = 5;

type AssignmentRecord = NonNullable<Awaited<ReturnType<typeof loadAssignment>>>;

async function loadAssignment(executor: Executor, assignmentId: string, options: { forUpdate?: boolean } = {}) {
  const query = executor
    .select({
      assignment: prayerAssignments,
      chain: prayerChains,
      chainDate: prayerSlots.chainDate,
      person: { firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName },
    })
    .from(prayerAssignments)
    .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
    .innerJoin(prayerChains, eq(prayerChains.id, prayerSlots.prayerChainId))
    .innerJoin(people, eq(people.id, prayerAssignments.personId))
    .where(eq(prayerAssignments.id, assignmentId));
  const [row] = options.forUpdate ? await query.for('update', { of: prayerAssignments }) : await query;
  return row ?? null;
}

function timingOf({ assignment: a, chain }: AssignmentRecord): AssignmentTiming {
  return {
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    graceMinutes: chain.graceMinutes,
    checkinOpensMinutes: chain.checkinOpensMinutes,
    requireCheckin: chain.requireCheckin,
    hasReport: a.reportResponseId !== null,
    reportFormAvailable: chain.reportFormId !== null,
  };
}

const clock = (instant: Date, timeZone: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone }).format(instant);

// ─── What the participant sees ────────────────────────────────────────────────

export type ParticipantSlotState = 'upcoming' | 'confirmed' | 'praying' | 'completed' | 'needs_follow_up' | 'resolved' | 'reassigned';

const STATE: Record<PrayerAssignmentStatus, ParticipantSlotState> = {
  scheduled: 'upcoming',
  confirmed: 'confirmed',
  in_prayer: 'praying',
  completed: 'completed',
  needs_follow_up: 'needs_follow_up',
  missed: 'resolved',
  excused: 'resolved',
  replaced: 'reassigned',
  cancelled: 'reassigned',
};

export interface ParticipantSlot {
  id: string;
  chainName: string;
  /** Local date and time, with both dates when the slot crosses midnight. */
  slotLabel: string;
  state: ParticipantSlotState;
  completedLate: boolean;
  cannotMakeIt: boolean;
  /** The one main button for this moment (docs/04 P7). */
  primaryAction: 'confirm' | 'check_in' | 'complete' | null;
  canSayCannotMakeIt: boolean;
  canReport: boolean;
  /** e.g. "You can confirm until 2:00 AM" or "Check-in opens at 1:45 AM". */
  hint: string | null;
}

function toSlot(record: AssignmentRecord, now: Date): ParticipantSlot {
  const { assignment: a, chain } = record;
  const timing = timingOf(record);
  const primary = primaryAction(timing, now);
  let hint: string | null = null;
  if (primary === 'confirm') {
    hint = `You can confirm until ${clock(a.startsAt, chain.timezone)}.`;
  } else if (!primary && (a.status === 'scheduled' || a.status === 'confirmed')) {
    const checkIn = actionWindow('check_in', timing, now);
    if (checkIn.opensAt && now < checkIn.opensAt) hint = `Check-in opens at ${clock(checkIn.opensAt, chain.timezone)}.`;
  }
  return {
    id: a.id,
    chainName: chain.name,
    slotLabel: formatSlotRange(a.startsAt, a.endsAt, chain.timezone, { withDate: true }),
    state: STATE[a.status],
    completedLate: a.completedLate,
    cannotMakeIt: a.cannotMakeItAt !== null,
    primaryAction: primary,
    canSayCannotMakeIt: a.cannotMakeItAt === null && actionWindow('cannot_make_it', timing, now).allowed,
    canReport: actionWindow('report', timing, now).allowed,
    hint,
  };
}

export interface ReportForm {
  versionId: string;
  fields: FieldDefinition[];
}

async function reportFormFor(executor: Executor, record: AssignmentRecord): Promise<ReportForm | null> {
  if (!record.chain.reportFormId) return null;
  const [form] = await executor.select({ key: forms.key }).from(forms).where(eq(forms.id, record.chain.reportFormId));
  const version = form ? await getPublishedForm(executor, form.key) : null;
  return version ? { versionId: version.versionId, fields: version.fields } : null;
}

async function inspectLink(executor: Executor, token: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return { kind: 'invalid' as const };
  const [row] = await executor
    .select({ subjectId: actionTokens.subjectId, personId: actionTokens.personId, revokedAt: actionTokens.revokedAt, expiresAt: actionTokens.expiresAt })
    .from(actionTokens)
    .where(and(eq(actionTokens.tokenHash, sha256Hex(token)), eq(actionTokens.purpose, 'prayer_assignment')));
  if (!row?.subjectId || row.expiresAt <= now) return { kind: 'invalid' as const };
  return { kind: row.revokedAt ? ('revoked' as const) : ('active' as const), assignmentId: row.subjectId, personId: row.personId };
}

/** The page behind a personal action link (docs/04 P7). A link for a slot given to someone else says so kindly. */
export async function getSlotByActionLink(db: Database, token: string, now: Date) {
  const link = await inspectLink(db, token, now);
  if (link.kind === 'invalid') return { status: 'invalid' as const };
  const record = await loadAssignment(db, link.assignmentId);
  if (!record || record.assignment.personId !== link.personId) return { status: 'invalid' as const };
  if (link.kind === 'revoked') {
    return STATE[record.assignment.status] === 'reassigned' ? { status: 'reassigned' as const, chainName: record.chain.name } : { status: 'invalid' as const };
  }
  const slot = toSlot(record, now);
  return {
    status: 'ok' as const,
    firstName: record.person.preferredName ?? record.person.firstName,
    slot,
    report: slot.canReport ? await reportFormFor(db, record) : null,
  };
}

async function slotsForPerson(executor: Executor, chain: ChainRow, personId: string, now: Date): Promise<ParticipantSlot[]> {
  const rows = await executor
    .select({ id: prayerAssignments.id })
    .from(prayerAssignments)
    .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
    .where(
      and(
        eq(prayerSlots.prayerChainId, chain.id),
        eq(prayerAssignments.personId, personId),
        or(
          and(
            inArray(prayerAssignments.status, ['scheduled', 'confirmed', 'in_prayer']),
            gt(prayerAssignments.endsAt, new Date(now.getTime() - chain.graceMinutes * 60_000)),
          ),
          and(eq(prayerAssignments.status, 'needs_follow_up'), gt(prayerAssignments.endsAt, new Date(now.getTime() - 7 * 86_400_000))),
        ),
      ),
    )
    .orderBy(asc(prayerAssignments.startsAt))
    .limit(MY_SLOTS_LIMIT);
  const slots: ParticipantSlot[] = [];
  for (const row of rows) {
    const record = await loadAssignment(executor, row.id);
    if (record) slots.push(toSlot(record, now));
  }
  return slots;
}

/**
 * How one hour reads on a page anyone can open. Nothing here is a judgement on a person: an hour
 * that ended without anyone marking it finished is "covered", not "missed" — under BR-PR-04 only a
 * coordinator decides that, and they do it on the board, not in public.
 */
export type PublicSlotState = 'available' | 'open_now' | 'praying' | 'reserved' | 'completed' | 'covered' | 'unfilled';

export interface PublicSlot {
  id: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  state: PublicSlotState;
  /** Whether it can still be taken — capacity decides this as much as the state does. */
  claimable: boolean;
  placesLeft: number;
  capacity: number;
  /** First names, and only when the chain publishes them. Never a surname on a page anyone can open. */
  names: string[] | null;
  /** This device's person holds it. */
  mine: boolean;
}

async function publicSchedule(executor: Executor, chain: ChainRow, date: string, personId: string | null, now: Date) {
  const slots = await executor
    .select({ id: prayerSlots.id, startsAt: prayerSlots.startsAt, endsAt: prayerSlots.endsAt, capacity: prayerSlots.capacity })
    .from(prayerSlots)
    .where(and(eq(prayerSlots.prayerChainId, chain.id), eq(prayerSlots.chainDate, date), eq(prayerSlots.status, 'open')))
    .orderBy(asc(prayerSlots.startsAt));

  const holders =
    slots.length === 0
      ? []
      : await executor
          .select({
            slotId: prayerAssignments.slotId,
            personId: prayerAssignments.personId,
            status: prayerAssignments.status,
            firstName: people.firstName,
            preferredName: people.preferredName,
          })
          .from(prayerAssignments)
          .innerJoin(people, eq(people.id, prayerAssignments.personId))
          .where(and(inArray(prayerAssignments.slotId, slots.map((s) => s.id)), inArray(prayerAssignments.status, [...HOLDS_PLACE])))
          .orderBy(asc(prayerAssignments.createdAt));

  const nowMs = now.getTime();
  const list: PublicSlot[] = slots.map((slot) => {
    const on = holders.filter((h) => h.slotId === slot.id);
    const started = slot.startsAt.getTime() <= nowMs;
    const over = slot.endsAt.getTime() <= nowMs;
    const placesLeft = Math.max(0, slot.capacity - on.length);
    const state: PublicSlotState =
      on.length === 0
        ? over
          ? 'unfilled'
          : started
            ? 'open_now'
            : 'available'
        : over
          ? on.some((h) => h.status === 'completed')
            ? 'completed'
            : 'covered'
          : started && on.some((h) => h.status === 'in_prayer')
            ? 'praying'
            : 'reserved';
    return {
      id: slot.id,
      label: formatSlotRange(slot.startsAt, slot.endsAt, chain.timezone),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      state,
      claimable: !over && placesLeft > 0,
      placesLeft,
      capacity: slot.capacity,
      names: chain.showNamesPublicly ? on.map((h) => h.preferredName ?? h.firstName.split(' ')[0]!) : null,
      mine: personId !== null && on.some((h) => h.personId === personId),
    };
  });

  const held = (s: PublicSlot) => s.state !== 'available' && s.state !== 'open_now' && s.state !== 'unfilled';
  return {
    slots: list,
    summary: {
      total: list.length,
      covered: list.filter(held).length,
      available: list.filter((s) => s.claimable).length,
      completed: list.filter((s) => s.state === 'completed').length,
      unfilled: list.filter((s) => s.state === 'unfilled').length,
    },
  };
}

export const ChainPageInput = z.object({
  code: z.string().trim().min(1).max(20),
  /** The chain-local day being looked at; today when it is left out. */
  date: z.iso.date().optional().catch(undefined),
  scan: z.boolean().default(false),
});

/** The public chain page (docs/04 P6): who is praying now, today's coverage, and — for a remembered device — your slots. */
export async function getChainPage(db: Database, raw: unknown, identity: ParticipantIdentity | null, now: Date) {
  const input = parseInput(ChainPageInput, raw);
  const code = await resolveEntryCode(db, input.code, ['prayer_chain']);
  if (!code?.prayerChainId) return { status: 'not_found' as const };
  if (input.scan) await recordEntryCodeScan(db, code.id, now).catch(() => undefined);
  if (code.status !== 'active') return { status: 'retired' as const };
  const [chain] = await db
    .select()
    .from(prayerChains)
    .where(and(eq(prayerChains.id, code.prayerChainId), isNull(prayerChains.archivedAt)));
  if (!chain) return { status: 'not_found' as const };

  const [current] = await db
    .select({ id: prayerSlots.id, startsAt: prayerSlots.startsAt, endsAt: prayerSlots.endsAt })
    .from(prayerSlots)
    .where(and(eq(prayerSlots.prayerChainId, chain.id), eq(prayerSlots.status, 'open'), lte(prayerSlots.startsAt, now), gt(prayerSlots.endsAt, now)))
    .limit(1);
  const praying = current
    ? await db
        .select({ firstName: people.firstName, preferredName: people.preferredName })
        .from(prayerAssignments)
        .innerJoin(people, eq(people.id, prayerAssignments.personId))
        .where(and(eq(prayerAssignments.slotId, current.id), eq(prayerAssignments.status, 'in_prayer')))
    : [];
  const coverage = await todayCoverage(db, chain, now);
  const today = chainToday(chain, now);
  const date = input.date ?? today;
  const schedule = await publicSchedule(db, chain, date, identity?.personId ?? null, now);
  const [person] = identity
    ? await db.select({ firstName: people.firstName, preferredName: people.preferredName }).from(people).where(eq(people.id, identity.personId))
    : [];

  return {
    status: 'ok' as const,
    chain: { name: chain.name, description: chain.description, state: chain.status, timezone: chain.timezone },
    now: current
      ? {
          slotLabel: formatSlotRange(current.startsAt, current.endsAt, chain.timezone),
          prayingCount: praying.length,
          // First names only, and only when the chain allows it.
          prayingFirstNames: chain.showNamesPublicly ? praying.map((p) => p.preferredName ?? p.firstName.split(' ')[0]!) : null,
        }
      : null,
    coverageToday: { covered: coverage.covered, total: coverage.total },
    /** Every hour of the chosen day, so the gaps are visible rather than counted (docs/04 P6). */
    schedule: {
      date,
      today,
      previousDate: addDays(date, -1),
      nextDate: addDays(date, 1),
      selfSignup: chain.allowSelfSignup && chain.status === 'active',
      ...schedule,
    },
    participant:
      identity && person
        ? { firstName: person.preferredName ?? person.firstName, slots: await slotsForPerson(db, chain, identity.personId, now) }
        : null,
  };
}

// ─── What the participant does ────────────────────────────────────────────────

const reassigned = () => invalidState('This slot has been reassigned — thank you!', { reason: 'REASSIGNED' });
const linkExpired = () => new AppError('GONE', 'This link has expired. Please ask your coordinator for a new one.');

type ActingAs = { kind: 'link'; token: string } | { kind: 'device'; identity: ParticipantIdentity; assignmentId: string };

/** Locks the assignment the participant is acting on, after checking the link or device belongs to it. */
async function lockForParticipant(tx: Transaction, actingAs: ActingAs, now: Date) {
  if (actingAs.kind === 'device') {
    const record = await loadAssignment(tx, actingAs.assignmentId, { forUpdate: true });
    if (!record || record.assignment.personId !== actingAs.identity.personId) throw notFound('prayer slot');
    return { record, tokenId: null, via: 'chain_page' as const };
  }
  const identity = await resolvePrayerActionToken(tx, actingAs.token, now);
  if (!identity) {
    // Links are revoked only when their slot was given to someone else or removed.
    if ((await inspectLink(tx, actingAs.token, now)).kind === 'revoked') throw reassigned();
    throw linkExpired();
  }
  const record = await loadAssignment(tx, identity.assignmentId, { forUpdate: true });
  if (!record || record.assignment.personId !== identity.personId) throw linkExpired();
  return { record, tokenId: identity.tokenId, via: 'action_link' as const };
}

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const ActionFields = z.object({
  action: z.enum(['confirm', 'check_in', 'complete', 'cannot_make_it']),
  reason: z.enum(CANNOT_MAKE_IT_REASONS).optional(),
  note: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
});
type ActionFields = z.infer<typeof ActionFields>;

export const LinkActionInput = ActionFields.extend({ token: z.string().trim().min(32).max(64) });
export const DeviceActionInput = ActionFields.extend({ assignmentId: z.uuid() });

function windowClosed(action: ActionFields['action'], record: AssignmentRecord, now: Date): AppError {
  const { assignment: a, chain } = record;
  const timing = timingOf(record);
  let message: string;
  switch (action) {
    case 'confirm':
      message = actionWindow('check_in', timing, now).allowed ? 'Your slot is starting — tap “I’m praying now” instead.' : 'This slot can no longer be confirmed.';
      break;
    case 'check_in': {
      const opensAt = new Date(a.startsAt.getTime() - chain.checkinOpensMinutes * 60_000);
      message = now < opensAt ? `Check-in opens at ${clock(opensAt, chain.timezone)}.` : 'This slot has ended. If you prayed, tap “I’ve finished praying”.';
      break;
    }
    case 'complete':
      message =
        now < a.startsAt
          ? `You can mark it finished from ${clock(a.startsAt, chain.timezone)}.`
          : chain.requireCheckin
            ? 'Please tap “I’m praying now” first.'
            : 'This slot can no longer be marked finished.';
      break;
    case 'cannot_make_it':
      message = 'This slot has already ended.';
      break;
  }
  return new AppError('VALIDATION_ERROR', message, { meta: { reason: 'WINDOW_NOT_OPEN' } });
}

/** One participant action on a locked assignment (docs/05 W12 state machine). */
async function applyAction(tx: Transaction, record: AssignmentRecord, input: ActionFields, via: 'action_link' | 'chain_page', now: Date) {
  const { assignment: a, chain } = record;
  const state = STATE[a.status];
  if (state === 'reassigned') throw reassigned();
  if (state === 'resolved') throw invalidState('Your coordinator has already updated this slot. Thank you!', { reason: 'RESOLVED' });

  // A second tap, or a retry after a dropped connection, changes nothing.
  const alreadyDone =
    (input.action === 'confirm' && ['confirmed', 'in_prayer', 'completed'].includes(a.status)) ||
    (input.action === 'check_in' && ['in_prayer', 'completed'].includes(a.status)) ||
    (input.action === 'complete' && a.status === 'completed') ||
    (input.action === 'cannot_make_it' && a.cannotMakeItAt !== null);
  if (alreadyDone) return;

  const timing = timingOf(record);
  if (!actionWindow(input.action, timing, now).allowed) throw windowClosed(input.action, record, now);

  const actor = { type: 'participant' } as const;
  const update = (values: Partial<typeof prayerAssignments.$inferInsert>) =>
    tx
      .update(prayerAssignments)
      .set({ ...values, updatedAt: now })
      .where(eq(prayerAssignments.id, a.id));

  switch (input.action) {
    case 'confirm':
      await update({ status: 'confirmed', confirmedAt: now });
      await recordPrayerEvent(tx, { assignmentId: a.id, eventType: 'confirmed', actor, via, at: now });
      return;
    case 'check_in':
      await update({ status: 'in_prayer', checkedInAt: now, confirmedAt: a.confirmedAt ?? now });
      await recordPrayerEvent(tx, { assignmentId: a.id, eventType: 'checked_in', actor, via, at: now });
      return;
    case 'complete': {
      const late = isLateCompletion(timing, now);
      await update({ status: 'completed', completedAt: now, completedLate: late });
      await recordPrayerEvent(tx, { assignmentId: a.id, eventType: 'completed', actor, via, at: now, note: late ? 'Marked finished after the grace period' : null });
      // Finishing late before the coordinator decides closes the follow-up (docs/05 W13 step 5).
      if (a.status === 'needs_follow_up') await closePrayerFollowUp(tx, a.id, { note: 'Marked finished by the person', resolvedBy: null, now });
      return;
    }
    case 'cannot_make_it': {
      const reason = CANNOT_MAKE_IT_LABELS[input.reason ?? 'other'];
      await update({ cannotMakeItAt: now });
      await recordPrayerEvent(tx, { assignmentId: a.id, eventType: 'cannot_make_it', actor, via, at: now, note: input.note ? `${reason}: ${input.note}` : reason });
      const personName = `${record.person.preferredName ?? record.person.firstName} ${record.person.lastName.charAt(0)}.`;
      const slotLabel = formatSlotRange(a.startsAt, a.endsAt, chain.timezone, { withDate: true });
      for (const userId of await coordinatorUserIds(tx, { id: chain.id, ministryId: chain.ministryId })) {
        await queueNotification(tx, {
          templateKey: 'prayer.cannot_make_it',
          recipientUserId: userId,
          payload: { personName, chainName: chain.name, slotLabel, chainId: chain.id, chainDate: record.chainDate },
          dedupeKey: `prayer_cannot_make_it:${a.id}:${userId}`,
        });
      }
      return;
    }
  }
}

async function respond(db: Database, req: PublicRequest, actingAs: ActingAs, input: ActionFields) {
  if (req.ip) await assertRateLimit(db, `prayer:respond:ip:${req.ip}`, RATE_LIMITS.prayerRespondPerIp, req.now);
  return db.transaction(async (tx) => {
    const { record, tokenId, via } = await lockForParticipant(tx, actingAs, req.now);
    await applyAction(tx, record, input, via, req.now);
    if (tokenId) await recordPrayerTokenUse(tx, tokenId, req.now);
    const updated = (await loadAssignment(tx, record.assignment.id))!;
    const slot = toSlot(updated, req.now);
    return { slot, report: slot.canReport ? await reportFormFor(tx, updated) : null };
  });
}

export async function respondWithActionLink(db: Database, req: PublicRequest, raw: unknown) {
  const input = parseInput(LinkActionInput, raw);
  return respond(db, req, { kind: 'link', token: input.token }, input);
}

export async function respondFromChainPage(db: Database, identity: ParticipantIdentity, req: PublicRequest, raw: unknown) {
  const input = parseInput(DeviceActionInput, raw);
  return respond(db, req, { kind: 'device', identity, assignmentId: input.assignmentId }, input);
}

// ─── Taking an hour (docs/05 W11 self sign-up) ────────────────────────────────

export const ClaimSlotInput = z.object({
  code: z.string().trim().min(1).max(20),
  slotId: z.uuid(),
  /** Set when they are moving from the hour they already hold in this chain. */
  replaceAssignmentId: z.uuid().optional(),
});

/** The same refusals as the coordinator's, said to the person themselves. */
const SELF_SIGNUP_MESSAGES: Record<PlacementFailure, string> = {
  SLOT_CLOSED: 'That hour has already passed.',
  PERSON_UNAVAILABLE: 'Please ask your prayer coordinator to help you join.',
  ALREADY_ASSIGNED: 'You already have this hour.',
  CAPACITY_FULL: 'Someone has just taken that hour. Please choose another one.',
  OVERLAP: 'You are already praying at that time.',
};

export type ClaimResult =
  | { result: 'claimed'; slot: ParticipantSlot }
  /** They already hold an hour here, so the page offers to keep it or move. */
  | { result: 'already_assigned'; current: ParticipantSlot };

/** The hour this person holds in this chain and has not finished with yet. */
async function heldInChain(executor: Executor, chainId: string, personId: string, now: Date) {
  const [row] = await executor
    .select({ id: prayerAssignments.id })
    .from(prayerAssignments)
    .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
    .where(
      and(
        eq(prayerSlots.prayerChainId, chainId),
        eq(prayerAssignments.personId, personId),
        inArray(prayerAssignments.status, ['scheduled', 'confirmed', 'in_prayer']),
        gt(prayerAssignments.endsAt, now),
      ),
    )
    .orderBy(asc(prayerAssignments.startsAt))
    .limit(1);
  return row ? await loadAssignment(executor, row.id) : null;
}

/**
 * Someone takes an open hour from the chain page (docs/05 W11). Every rule is the coordinator's
 * own: `placeAssignment` decides whether the hour is open, has room, and leaves the person free,
 * with the exclusion constraint as the last guard against two people tapping at once.
 */
export async function claimSlot(db: Database, identity: ParticipantIdentity, req: PublicRequest, raw: unknown): Promise<ClaimResult> {
  const input = parseInput(ClaimSlotInput, raw);
  if (req.ip) await assertRateLimit(db, `prayer:claim:ip:${req.ip}`, RATE_LIMITS.prayerClaimPerIp, req.now);
  await assertRateLimit(db, `prayer:claim:person:${identity.personId}`, RATE_LIMITS.prayerClaimPerPerson, req.now);

  return db.transaction(async (tx) => {
    const code = await resolveEntryCode(tx, input.code, ['prayer_chain']);
    if (!code?.prayerChainId || code.status !== 'active') throw notFound('prayer chain');
    const chain = await loadChain(tx, code.prayerChainId);
    if (!chain || chain.archivedAt) throw notFound('prayer chain');
    if (chain.status !== 'active') throw invalidState('This prayer chain isn’t open right now.');
    if (!chain.allowSelfSignup) throw invalidState('Hours in this chain are arranged by the prayer coordinator.');

    // The hour has to belong to the chain whose code was opened.
    const [slot] = await tx
      .select({ id: prayerSlots.id })
      .from(prayerSlots)
      .where(and(eq(prayerSlots.id, input.slotId), eq(prayerSlots.prayerChainId, chain.id)));
    if (!slot) throw notFound('prayer slot');

    const held = await heldInChain(tx, chain.id, identity.personId, req.now);
    if (held && held.assignment.id !== input.replaceAssignmentId) {
      return { result: 'already_assigned', current: toSlot(held, req.now) };
    }
    if (held && held.assignment.startsAt <= req.now) {
      throw invalidState('Your hour has already started. Please ask your coordinator if you need to change it.');
    }

    const placed = await placeAssignment(tx, {
      slotId: input.slotId,
      personId: identity.personId,
      source: 'self_signup',
      createdBy: null,
      actor: { type: 'participant' },
      via: 'chain_page',
      now: req.now,
    });
    if (!placed.ok) throw conflict(SELF_SIGNUP_MESSAGES[placed.reason], { reason: placed.reason });

    // Only once the new hour is theirs: a refusal must never leave someone with no hour at all.
    // The status is re-checked in the UPDATE, so nothing is lost if it changed while they chose.
    if (held) {
      const cancelled = await tx
        .update(prayerAssignments)
        .set({ status: 'cancelled', updatedAt: req.now })
        .where(and(eq(prayerAssignments.id, held.assignment.id), inArray(prayerAssignments.status, ['scheduled', 'confirmed'])))
        .returning({ id: prayerAssignments.id });
      if (cancelled.length > 0) {
        await revokeAssignmentLinks(tx, held.assignment.id, req.now);
        await recordPrayerEvent(tx, {
          assignmentId: held.assignment.id,
          eventType: 'cancelled',
          actor: { type: 'participant' },
          via: 'chain_page',
          at: req.now,
          note: 'Moved to another hour',
        });
      }
    }

    await recordAudit(tx, participantContext(req, identity.personId), {
      category: 'change',
      action: held ? 'prayer.slot_changed' : 'prayer.self_signed_up',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { assignmentId: placed.assignmentId, slotId: input.slotId, movedFrom: held?.assignment.id ?? null },
    });

    return { result: 'claimed', slot: toSlot((await loadAssignment(tx, placed.assignmentId))!, req.now) };
  });
}

// ─── The optional report (docs/05 W12 step 6) ─────────────────────────────────

const ReportFields = z.object({
  answers: z.record(z.string(), z.unknown()),
  anonymous: z.boolean().default(false),
});
type ReportFields = z.infer<typeof ReportFields>;

export const LinkReportInput = ReportFields.extend({ token: z.string().trim().min(32).max(64) });
export const DeviceReportInput = ReportFields.extend({ assignmentId: z.uuid() });

async function report(db: Database, req: PublicRequest, actingAs: ActingAs, input: ReportFields) {
  if (req.ip) await assertRateLimit(db, `prayer:report:ip:${req.ip}`, RATE_LIMITS.prayerReportPerIp, req.now);
  if (JSON.stringify(input.answers).length > REPORT_MAX_BYTES) throw validationError({ _: ['This is too long to send.'] });

  return db.transaction(async (tx) => {
    const { record, tokenId, via } = await lockForParticipant(tx, actingAs, req.now);
    if (record.assignment.reportResponseId) throw conflict('Thank you — your report was already received.', { reason: 'ALREADY_SUBMITTED' });
    if (!actionWindow('report', timingOf(record), req.now).allowed) {
      throw invalidState('A report can be shared for a week after you finish praying.', { reason: 'WINDOW_NOT_OPEN' });
    }
    const form = await reportFormFor(tx, record);
    if (!form) throw invalidState('This prayer chain doesn’t collect reports.');

    const outcome = validateAnswers(form.fields, input.answers);
    if (!outcome.ok) throw validationError(outcome.fieldErrors);
    if (Object.keys(outcome.answers).length === 0) throw validationError({ _: ['Write something to share, or close this form.'] });

    const [response] = await tx
      .insert(formResponses)
      .values({ formVersionId: form.versionId, personId: record.assignment.personId, isAnonymous: input.anonymous, submittedAt: req.now })
      .returning({ id: formResponses.id });
    const sets = Object.entries(splitBySensitivity(form.fields, outcome.answers)).map(([sensitivity, answers]) => ({
      responseId: response!.id,
      sensitivity: sensitivity as FieldDefinition['sensitivity'],
      answers,
    }));
    if (sets.length > 0) await tx.insert(formAnswerSets).values(sets);
    await tx
      .update(prayerAssignments)
      .set({ reportResponseId: response!.id, updatedAt: req.now })
      .where(eq(prayerAssignments.id, record.assignment.id));
    await recordPrayerEvent(tx, { assignmentId: record.assignment.id, eventType: 'report_submitted', actor: { type: 'participant' }, via, at: req.now });
    if (tokenId) await recordPrayerTokenUse(tx, tokenId, req.now);
    return { received: true as const };
  });
}

export async function submitReportWithActionLink(db: Database, req: PublicRequest, raw: unknown) {
  const input = parseInput(LinkReportInput, raw);
  return report(db, req, { kind: 'link', token: input.token }, input);
}

export async function submitReportFromChainPage(db: Database, identity: ParticipantIdentity, req: PublicRequest, raw: unknown) {
  const input = parseInput(DeviceReportInput, raw);
  return report(db, req, { kind: 'device', identity, assignmentId: input.assignmentId }, input);
}
