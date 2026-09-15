import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { newId } from '@/lib/ids';
import { queryRows, type Database, type Executor } from '../../db/client';
import { actionTokens, prayerAssignmentEvents, prayerAssignments, prayerChainSchedules, prayerChains, prayerCommitments } from '../../db/schema';
import { addDays, localDate } from '../journal/journal-dates';
import { earlier, later, type ChainRow, type EventActor } from './common';
import { placeAssignment, type PlacementFailure } from './placement';
import { expandDates, occursOn, parseRecurrence } from './recurrence';
import { chainLocalTime, slotsForOccurrence, type SlotTime } from './slot-times';

/**
 * Slot generation (docs/05 W10 step 5, docs/02 §7 `prayer.generate_slots`). Idempotent: slots are
 * keyed by (chain, start), and a new slot is skipped if it would overlap an open one. Standing
 * commitments are then applied to matching future slots; conflicts are reported, never dropped
 * silently, and a slot a commitment already filled once is never refilled by it (so a
 * coordinator's substitution sticks).
 */

const INSERT_CHUNK = 400;
const LOCK_NAMESPACE = 7401;

export interface CommitmentConflict {
  commitmentId: string;
  personId: string;
  startsAt: Date;
  reason: PlacementFailure;
}

export interface GenerationResult {
  slotsCreated: number;
  assignmentsCreated: number;
  conflicts: CommitmentConflict[];
}

async function insertSlots(tx: Executor, chainId: string, scheduleId: string, capacity: number, slots: SlotTime[]): Promise<number> {
  if (slots.length === 0) return 0;
  const values = sql.join(
    slots.map(
      (s) => sql`(${newId()}::uuid, ${s.chainDate}::date, ${s.startsAt.toISOString()}::timestamptz, ${s.endsAt.toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  const inserted = await queryRows<{ id: string }>(
    tx,
    sql`INSERT INTO prayer_slots (id, prayer_chain_id, schedule_id, chain_date, starts_at, ends_at, capacity)
        SELECT v.id, ${chainId}::uuid, ${scheduleId}::uuid, v.chain_date, v.starts_at, v.ends_at, ${capacity}::smallint
          FROM (VALUES ${values}) AS v(id, chain_date, starts_at, ends_at)
         WHERE NOT EXISTS (
                 SELECT 1 FROM prayer_slots o
                  WHERE o.prayer_chain_id = ${chainId}::uuid AND o.status = 'open'
                    AND tstzrange(o.starts_at, o.ends_at) && tstzrange(v.starts_at, v.ends_at))
        ON CONFLICT (prayer_chain_id, starts_at) DO NOTHING
        RETURNING id`,
  );
  return inserted.length;
}

async function applyCommitments(tx: Executor, chain: ChainRow, today: string, now: Date) {
  const conflicts: CommitmentConflict[] = [];
  let assigned = 0;
  const commitments = await tx
    .select()
    .from(prayerCommitments)
    .where(and(eq(prayerCommitments.prayerChainId, chain.id), isNull(prayerCommitments.endedAt)));

  for (const commitment of commitments) {
    const rule = parseRecurrence(commitment.rrule);
    if (!rule || (commitment.effectiveTo !== null && commitment.effectiveTo < today)) continue;
    const candidates = await queryRows<{ id: string; chain_date: string; starts_at: Date | string }>(
      tx,
      sql`SELECT s.id, s.chain_date::text AS chain_date, s.starts_at
            FROM prayer_slots s
           WHERE s.prayer_chain_id = ${chain.id}::uuid
             AND s.status = 'open'
             AND s.starts_at > ${now.toISOString()}::timestamptz
             AND s.chain_date >= ${later(today, commitment.effectiveFrom)}::date
             ${commitment.effectiveTo ? sql`AND s.chain_date <= ${commitment.effectiveTo}::date` : sql``}
             AND NOT EXISTS (SELECT 1 FROM prayer_assignments pa WHERE pa.slot_id = s.id AND pa.commitment_id = ${commitment.id}::uuid)
           ORDER BY s.starts_at`,
    );
    const localStart = commitment.localStartTime.slice(0, 5);
    for (const slot of candidates) {
      const startsAt = new Date(slot.starts_at);
      if (!occursOn(rule, slot.chain_date, commitment.effectiveFrom) || chainLocalTime(startsAt, chain.timezone) !== localStart) continue;
      const placed = await placeAssignment(tx, {
        slotId: slot.id,
        personId: commitment.personId,
        source: 'commitment',
        commitmentId: commitment.id,
        createdBy: null,
        actor: { type: 'system' },
        via: 'job',
        now,
      });
      if (placed.ok) assigned += 1;
      else if (placed.reason !== 'ALREADY_ASSIGNED') conflicts.push({ commitmentId: commitment.id, personId: commitment.personId, startsAt, reason: placed.reason });
    }
  }
  return { assigned, conflicts };
}

/** Materialises upcoming slots for one active chain and applies commitments. Call inside a transaction. */
export async function generateChainSlots(tx: Executor, chain: ChainRow, now: Date): Promise<GenerationResult> {
  const result: GenerationResult = { slotsCreated: 0, assignmentsCreated: 0, conflicts: [] };
  if (chain.status !== 'active' || chain.archivedAt) return result;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${chain.id}))`);
  const today = localDate(now, chain.timezone);

  const schedules = await tx.select().from(prayerChainSchedules).where(eq(prayerChainSchedules.prayerChainId, chain.id));
  for (const schedule of schedules) {
    const rule = parseRecurrence(schedule.rrule);
    if (!rule) continue;
    let to = addDays(today, schedule.generateDaysAhead);
    if (chain.endsOn) to = earlier(to, chain.endsOn);
    if (schedule.effectiveTo) to = earlier(to, schedule.effectiveTo);
    // From yesterday, so an occurrence that started yesterday and runs past midnight is complete.
    const from = later(addDays(today, -1), later(chain.startsOn, schedule.effectiveFrom));
    if (from > to) continue;

    const slots = expandDates(rule, { from, to }, { from: schedule.effectiveFrom, to: schedule.effectiveTo })
      .flatMap((date) => slotsForOccurrence(date, schedule, chain.timezone))
      .filter((slot) => slot.endsAt > now && slot.chainDate >= chain.startsOn && (!chain.endsOn || slot.chainDate <= chain.endsOn));
    for (let i = 0; i < slots.length; i += INSERT_CHUNK) {
      result.slotsCreated += await insertSlots(tx, chain.id, schedule.id, schedule.capacity, slots.slice(i, i + INSERT_CHUNK));
    }
  }

  const applied = await applyCommitments(tx, chain, today, now);
  result.assignmentsCreated = applied.assigned;
  result.conflicts = applied.conflicts;
  return result;
}

/** The `prayer.generate_slots` job: every active chain, one transaction each. */
export async function generateUpcomingSlots(db: Database, now: Date) {
  const chains = await db
    .select()
    .from(prayerChains)
    .where(and(eq(prayerChains.status, 'active'), isNull(prayerChains.archivedAt)));
  const totals = { chains: chains.length, slotsCreated: 0, assignmentsCreated: 0, conflicts: 0 };
  for (const chain of chains) {
    const result = await db.transaction((tx) => generateChainSlots(tx, chain, now));
    totals.slotsCreated += result.slotsCreated;
    totals.assignmentsCreated += result.assignmentsCreated;
    totals.conflicts += result.conflicts.length;
  }
  return totals;
}

/**
 * Cancels open slots that haven't started (a whole chain, or one schedule) and the assignments on
 * them that nobody has acted on yet; their links stop working. Cancelled slots also stop the
 * generator from recreating them.
 */
export async function cancelUpcomingSlots(
  tx: Executor,
  input: { chainId: string; scheduleId?: string; now: Date; actor: EventActor; reason: string },
) {
  const slots = await queryRows<{ id: string }>(
    tx,
    sql`UPDATE prayer_slots SET status = 'cancelled'
         WHERE prayer_chain_id = ${input.chainId}::uuid AND status = 'open'
           AND starts_at > ${input.now.toISOString()}::timestamptz
           ${input.scheduleId ? sql`AND schedule_id = ${input.scheduleId}::uuid` : sql``}
     RETURNING id`,
  );
  if (slots.length === 0) return { slots: 0, assignments: 0 };

  const cancelled = await tx
    .update(prayerAssignments)
    .set({ status: 'cancelled', updatedAt: input.now })
    .where(
      and(
        inArray(
          prayerAssignments.slotId,
          slots.map((s) => s.id),
        ),
        inArray(prayerAssignments.status, ['scheduled', 'confirmed']),
      ),
    )
    .returning({ id: prayerAssignments.id });
  if (cancelled.length > 0) {
    const ids = cancelled.map((a) => a.id);
    await tx
      .update(actionTokens)
      .set({ revokedAt: input.now })
      .where(and(eq(actionTokens.purpose, 'prayer_assignment'), inArray(actionTokens.subjectId, ids), isNull(actionTokens.revokedAt)));
    await tx.insert(prayerAssignmentEvents).values(
      ids.map((assignmentId) => ({
        assignmentId,
        eventType: 'cancelled' as const,
        occurredAt: input.now,
        actorType: input.actor.type,
        actorUserId: input.actor.type === 'user' ? input.actor.userId : null,
        via: 'portal' as const,
        note: input.reason,
      })),
    );
  }
  return { slots: slots.length, assignments: cancelled.length };
}
