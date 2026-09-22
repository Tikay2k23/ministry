import { and, eq, inArray, sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';
import { isExclusionViolation, isUniqueViolation } from '../../db/errors';
import { people, prayerAssignments, prayerSlots } from '../../db/schema';
import { recordPrayerEvent, type EventActor } from './common';

/**
 * Putting one person on one slot — the single place where the assignment rules live
 * (docs/05 W11): the slot must be open and not over, the person active, not already on the
 * slot, the slot not full, and the person free at that time across every chain (BR-PR-01).
 * The GiST exclusion constraint is the final guard against races.
 */

export type PlacementFailure = 'SLOT_CLOSED' | 'PERSON_UNAVAILABLE' | 'ALREADY_ASSIGNED' | 'CAPACITY_FULL' | 'OVERLAP';

/** Statuses that occupy a place on the slot. */
export const HOLDS_PLACE = ['scheduled', 'confirmed', 'in_prayer', 'completed', 'needs_follow_up'] as const;

export async function placeAssignment(
  tx: Executor,
  input: {
    slotId: string;
    personId: string;
    source: 'commitment' | 'manual' | 'substitute' | 'self_signup';
    commitmentId?: string;
    substituteForId?: string;
    /** Substitutes added after a slot started don't displace the original (docs/05 W14 step 4). */
    ignoreCapacity?: boolean;
    createdBy: string | null;
    actor: EventActor;
    via: 'portal' | 'job' | 'chain_page';
    now: Date;
    note?: string | null;
  },
): Promise<{ ok: true; assignmentId: string } | { ok: false; reason: PlacementFailure }> {
  const [slot] = await tx.select().from(prayerSlots).where(eq(prayerSlots.id, input.slotId)).for('update');
  if (!slot || slot.status !== 'open' || slot.endsAt <= input.now) return { ok: false, reason: 'SLOT_CLOSED' };

  const [person] = await tx.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, input.personId));
  if (!person || person.archivedAt) return { ok: false, reason: 'PERSON_UNAVAILABLE' };

  const holders = await tx
    .select({ personId: prayerAssignments.personId })
    .from(prayerAssignments)
    .where(and(eq(prayerAssignments.slotId, slot.id), inArray(prayerAssignments.status, [...HOLDS_PLACE])));
  if (holders.some((h) => h.personId === input.personId)) return { ok: false, reason: 'ALREADY_ASSIGNED' };
  if (!input.ignoreCapacity && holders.length >= slot.capacity) return { ok: false, reason: 'CAPACITY_FULL' };

  const [overlap] = await queryRows<{ id: string }>(
    tx,
    sql`SELECT id FROM prayer_assignments
         WHERE person_id = ${input.personId}::uuid
           AND status NOT IN ('replaced', 'cancelled', 'excused')
           AND tstzrange(starts_at, ends_at) && tstzrange(${slot.startsAt.toISOString()}::timestamptz, ${slot.endsAt.toISOString()}::timestamptz)
         LIMIT 1`,
  );
  if (overlap) return { ok: false, reason: 'OVERLAP' };

  let assignmentId: string;
  try {
    // A savepoint, so a constraint violation from a concurrent assignment doesn't abort the caller's transaction.
    assignmentId = await tx.transaction(async (savepoint) => {
      const [row] = await savepoint
        .insert(prayerAssignments)
        .values({
          slotId: slot.id,
          personId: input.personId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          source: input.source,
          commitmentId: input.commitmentId ?? null,
          substituteForId: input.substituteForId ?? null,
          createdBy: input.createdBy,
          note: input.note ?? null,
          // The service clock, not the database's: reminders measure notice from when someone was assigned.
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: prayerAssignments.id });
      return row!.id;
    });
  } catch (error) {
    if (isExclusionViolation(error)) return { ok: false, reason: 'OVERLAP' };
    if (isUniqueViolation(error)) return { ok: false, reason: 'ALREADY_ASSIGNED' };
    throw error;
  }
  await recordPrayerEvent(tx, { assignmentId, eventType: 'assigned', actor: input.actor, via: input.via, at: input.now, note: input.note });
  return { ok: true, assignmentId };
}

export const PLACEMENT_MESSAGES: Record<PlacementFailure, string> = {
  SLOT_CLOSED: 'This slot is no longer open.',
  PERSON_UNAVAILABLE: 'This person is no longer active.',
  ALREADY_ASSIGNED: 'This person is already on this slot.',
  CAPACITY_FULL: 'This slot is already full.',
  OVERLAP: 'This person is already praying at that time (in this or another chain).',
};
