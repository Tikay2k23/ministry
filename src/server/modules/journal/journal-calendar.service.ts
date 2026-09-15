import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import { CALENDAR_DAY_KINDS, PAUSE_REASONS } from '../../db/enums';
import { journalDays, journalPauses, ministryCalendarDays } from '../../db/schema';
import { conflict, invalidState, notFound, validationError } from '../../errors';
import { assertCanAccessPerson, assertGlobal, assertPermission, canAccessPerson, hasGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { getSetting } from '../settings/settings.service';
import { addDays, localDate } from './journal-dates';
import { markJournalLedgerDirty } from './ledger-dirty';
import { ensureJournalLedger } from './ledger.service';

/**
 * Rest days, personal pauses and individual excused days (docs/05 W6, FR-JRN-18..20).
 * Closed days are never rewritten by calendar or pause changes — only by excusing a day.
 */

const EXCUSE_LOOKBACK_DAYS = 31;

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

async function ministryToday(db: Database, now: Date) {
  const { timezone } = await getSetting(db, 'ministry.profile');
  return localDate(now, timezone);
}

// ─── Ministry calendar (rest days) ────────────────────────────────────────────

export const CalendarRangeInput = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, { message: 'Choose a valid date range.', path: ['to'] });

export async function listCalendarDays(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'journal.status.view');
  const { from, to } = parseInput(CalendarRangeInput, raw);
  return db
    .select({
      day: ministryCalendarDays.day,
      kind: ministryCalendarDays.kind,
      excusesJournal: ministryCalendarDays.excusesJournal,
      note: ministryCalendarDays.note,
    })
    .from(ministryCalendarDays)
    .where(and(gte(ministryCalendarDays.day, from), lte(ministryCalendarDays.day, to)))
    .orderBy(asc(ministryCalendarDays.day));
}

export const CalendarDayInput = z.object({
  day: z.iso.date(),
  kind: z.enum(CALENDAR_DAY_KINDS).default('journal_rest_day'),
  excusesJournal: z.boolean().default(true),
  note: optionalText(200),
});

export async function setCalendarDay(db: Database, ctx: RequestContext, raw: unknown) {
  assertGlobal(ctx, 'journal.settings.manage');
  const input = parseInput(CalendarDayInput, raw);
  const today = await ministryToday(db, ctx.now);
  if (input.day < today) {
    throw validationError({ day: ['Past days can’t be changed here. Excuse individual days instead.'] });
  }
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(ministryCalendarDays).where(eq(ministryCalendarDays.day, input.day));
    const values = { kind: input.kind, excusesJournal: input.excusesJournal, note: input.note ?? null };
    await tx
      .insert(ministryCalendarDays)
      .values({ day: input.day, ...values, createdBy: actorUserId(ctx) })
      .onConflictDoUpdate({ target: ministryCalendarDays.day, set: values });
    await markJournalLedgerDirty(tx);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'journal.calendar_day_set',
      entityType: 'ministry_calendar_day',
      entityId: input.day,
      oldValues: before ? { kind: before.kind, excusesJournal: before.excusesJournal } : null,
      newValues: { kind: input.kind, excusesJournal: input.excusesJournal },
    });
  });
}

export async function removeCalendarDay(db: Database, ctx: RequestContext, raw: unknown) {
  assertGlobal(ctx, 'journal.settings.manage');
  const { day } = parseInput(z.object({ day: z.iso.date() }), raw);
  const today = await ministryToday(db, ctx.now);
  if (day < today) throw validationError({ day: ['Past days can’t be changed here.'] });
  await db.transaction(async (tx) => {
    const removed = await tx.delete(ministryCalendarDays).where(eq(ministryCalendarDays.day, day)).returning();
    if (removed.length === 0) throw notFound('calendar day');
    await markJournalLedgerDirty(tx);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'journal.calendar_day_removed',
      entityType: 'ministry_calendar_day',
      entityId: day,
      oldValues: { kind: removed[0]!.kind, excusesJournal: removed[0]!.excusesJournal },
    });
  });
}

// ─── Personal pauses ──────────────────────────────────────────────────────────

export const PauseInput = z
  .object({
    personId: z.uuid(),
    startsOn: z.iso.date(),
    endsOn: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.iso.date().optional()),
    reason: z.enum(PAUSE_REASONS),
    note: optionalText(300),
  })
  .refine((p) => !p.endsOn || p.endsOn >= p.startsOn, {
    message: 'The end date must be on or after the start date.',
    path: ['endsOn'],
  });

export async function listPauses(db: Database, ctx: RequestContext, personId: string) {
  await assertCanAccessPerson(db, ctx, 'journal.status.view', personId);
  const showNotes = await canAccessPerson(db, ctx, 'journal.excuse', personId);
  const rows = await db
    .select()
    .from(journalPauses)
    .where(and(eq(journalPauses.personId, personId), isNull(journalPauses.cancelledAt)))
    .orderBy(desc(journalPauses.startsOn))
    .limit(20);
  return rows.map((p) => ({
    id: p.id,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    reason: p.reason,
    // Notes can mention health or family matters: only for people who manage pauses.
    note: showNotes ? p.note : null,
  }));
}

export async function addPause(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(PauseInput, raw);
  const today = await ministryToday(db, ctx.now);
  if (input.startsOn < addDays(today, -1)) {
    throw validationError({ startsOn: ['A pause can start yesterday at the earliest. Excuse earlier days one at a time.'] });
  }
  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'journal.excuse', input.personId);
    // Serialise pause changes for this person; the exclusion constraint is the final guard.
    await tx.execute(sql`SELECT id FROM people WHERE id = ${input.personId}::uuid FOR UPDATE`);
    const overlapping = await queryRows<{ id: string }>(
      tx,
      sql`SELECT id FROM journal_pauses
           WHERE person_id = ${input.personId}::uuid AND cancelled_at IS NULL
             AND daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]')
              && daterange(${input.startsOn}::date, coalesce(${input.endsOn ?? null}::date, 'infinity'::date), '[]')`,
    );
    if (overlapping.length > 0) throw conflict('This overlaps a pause that is already in place.');

    const [pause] = await tx
      .insert(journalPauses)
      .values({
        personId: input.personId,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        reason: input.reason,
        note: input.note ?? null,
        createdBy: actorUserId(ctx),
      })
      .returning({ id: journalPauses.id });
    await markJournalLedgerDirty(tx);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'journal.pause_added',
      entityType: 'person',
      entityId: input.personId,
      newValues: { pauseId: pause!.id, startsOn: input.startsOn, endsOn: input.endsOn ?? null, reason: input.reason },
    });
    return { pauseId: pause!.id };
  });
}

/** Ends a pause so journaling resumes today (or cancels one that hasn't started). */
export async function endPause(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(z.object({ pauseId: z.uuid() }), raw);
  const today = await ministryToday(db, ctx.now);
  await db.transaction(async (tx) => {
    const [pause] = await tx
      .select()
      .from(journalPauses)
      .where(and(eq(journalPauses.id, input.pauseId), isNull(journalPauses.cancelledAt)))
      .for('update');
    if (!pause) throw notFound('pause');
    await assertCanAccessPerson(tx, ctx, 'journal.excuse', pause.personId);

    const yesterday = addDays(today, -1);
    if (pause.endsOn !== null && pause.endsOn < today) throw invalidState('This pause has already ended.');
    const cancel = pause.startsOn >= today;
    await tx
      .update(journalPauses)
      .set(cancel ? { cancelledAt: ctx.now } : { endsOn: yesterday })
      .where(eq(journalPauses.id, pause.id));
    await markJournalLedgerDirty(tx);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: cancel ? 'journal.pause_cancelled' : 'journal.pause_ended',
      entityType: 'person',
      entityId: pause.personId,
      oldValues: { pauseId: pause.id, endsOn: pause.endsOn },
      newValues: cancel ? { cancelled: true } : { endsOn: yesterday },
    });
  });
}

// ─── Excusing individual days ─────────────────────────────────────────────────

export const ExcuseDayInput = z.object({
  personId: z.uuid(),
  journalDate: z.iso.date(),
  excused: z.boolean(),
  note: optionalText(300),
});

export async function setDayExcused(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ExcuseDayInput, raw);
  await ensureJournalLedger(db, ctx.now);
  const today = await ministryToday(db, ctx.now);
  if (input.journalDate > today || input.journalDate < addDays(today, -EXCUSE_LOOKBACK_DAYS)) {
    throw validationError({ journalDate: [`Days can be excused up to ${EXCUSE_LOOKBACK_DAYS} days back.`] });
  }

  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'journal.excuse', input.personId);
    const [day] = await tx
      .select()
      .from(journalDays)
      .where(and(eq(journalDays.personId, input.personId), eq(journalDays.journalDate, input.journalDate)))
      .for('update');
    if (!day) throw notFound('journal day');

    if (input.excused) {
      if (day.submissionStatus === 'submitted' || day.submissionStatus === 'late') {
        throw invalidState('A journal was already received for this day.');
      }
      if (day.submissionStatus === 'excused') return { status: day.submissionStatus };
      const excuseReason = hasGlobal(ctx, 'journal.excuse') ? 'admin_excused' : 'leader_excused';
      await tx
        .update(journalDays)
        .set({ submissionStatus: 'excused', excuseReason, updatedAt: ctx.now })
        .where(and(eq(journalDays.personId, input.personId), eq(journalDays.journalDate, input.journalDate)));
    } else {
      if (day.submissionStatus !== 'excused') return { status: day.submissionStatus };
      if (day.excuseReason === 'rest_day' || day.excuseReason === 'pause') {
        throw invalidState('This day is covered by a rest day or pause. Change that instead.');
      }
      if (!day.isExpected) throw invalidState('This person wasn’t expected to journal on this day.');
      await tx
        .update(journalDays)
        .set({ submissionStatus: day.finalizedAt ? 'missed' : 'pending', excuseReason: null, updatedAt: ctx.now })
        .where(and(eq(journalDays.personId, input.personId), eq(journalDays.journalDate, input.journalDate)));
    }

    await recordAudit(tx, ctx, {
      category: 'change',
      action: input.excused ? 'journal.day_excused' : 'journal.day_unexcused',
      entityType: 'person',
      entityId: input.personId,
      oldValues: { journalDate: input.journalDate, status: day.submissionStatus },
      reason: input.note ?? null,
    });
    return { status: input.excused ? 'excused' : day.finalizedAt ? 'missed' : 'pending' };
  });
}
