import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { formatClockTime } from '@/lib/time-range';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { actionTokens, people, prayerAssignmentEvents, prayerAssignments, prayerChainSchedules, prayerCommitments } from '../../db/schema';
import { conflict, invalidState, notFound, validationError } from '../../errors';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { addDays } from '../journal/journal-dates';
import { actorFromContext, chainForActor, chainToday, later, timeOfDay } from './common';
import { generateChainSlots } from './generation.service';
import { expandDates, formatRecurrence, occursOn, parseRecurrence } from './recurrence';
import { chainLocalTime, slotsForOccurrence } from './slot-times';

/** Standing commitments: "Mary prays every Tuesday at 2:00 AM" (docs/05 W11, FR-PRY-03). */

const MATCH_CHECK_DAYS = 28;

export const CommitmentInput = z
  .object({
    chainId: z.uuid(),
    personId: z.uuid(),
    rrule: z
      .string()
      .trim()
      .max(200)
      .refine((rule) => parseRecurrence(rule) !== null, 'Choose the days'),
    localStartTime: timeOfDay,
    effectiveFrom: z.iso.date(),
    effectiveTo: z.preprocess((v) => (v === '' ? null : v), z.iso.date().nullish()),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
    }
  });

export async function createCommitment(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CommitmentInput, raw);
  return db.transaction(async (tx) => {
    const chain = await chainForActor(tx, ctx, 'prayer.assign', input.chainId, { forUpdate: true });
    if (chain.status === 'ended') throw invalidState('This prayer chain has ended.');
    const [person] = await tx.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, input.personId));
    if (!person || person.archivedAt) throw notFound('person');

    const rule = parseRecurrence(input.rrule)!;
    const rrule = formatRecurrence(rule);
    const from = later(chainToday(chain, ctx.now), input.effectiveFrom);
    const to = addDays(from, MATCH_CHECK_DAYS);

    // The commitment must line up with a slot the chain actually has.
    const schedules = await tx.select().from(prayerChainSchedules).where(eq(prayerChainSchedules.prayerChainId, chain.id));
    const matches = schedules.some((schedule) => {
      const scheduleRule = parseRecurrence(schedule.rrule);
      if (!scheduleRule) return false;
      return expandDates(scheduleRule, { from, to }, { from: schedule.effectiveFrom, to: schedule.effectiveTo })
        .flatMap((date) => slotsForOccurrence(date, schedule, chain.timezone))
        .some((slot) => occursOn(rule, slot.chainDate, input.effectiveFrom) && chainLocalTime(slot.startsAt, chain.timezone) === input.localStartTime);
    });
    if (!matches) {
      throw validationError({ localStartTime: [`No slot in this chain starts at ${formatClockTime(input.localStartTime)} on those days.`] });
    }

    const sameTime = await tx
      .select({ id: prayerCommitments.id, rrule: prayerCommitments.rrule, effectiveFrom: prayerCommitments.effectiveFrom })
      .from(prayerCommitments)
      .where(
        and(
          eq(prayerCommitments.prayerChainId, chain.id),
          eq(prayerCommitments.personId, input.personId),
          eq(prayerCommitments.localStartTime, `${input.localStartTime}:00`),
          isNull(prayerCommitments.endedAt),
        ),
      );
    const duplicate = sameTime.some((existing) => {
      const existingRule = parseRecurrence(existing.rrule);
      return existingRule !== null && expandDates(existingRule, { from, to }, { from: existing.effectiveFrom, to: null }).some((d) => occursOn(rule, d, input.effectiveFrom));
    });
    if (duplicate) throw conflict('This person already has a commitment at that time.');

    const [commitment] = await tx
      .insert(prayerCommitments)
      .values({
        prayerChainId: chain.id,
        personId: input.personId,
        rrule,
        localStartTime: `${input.localStartTime}:00`,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: actorUserId(ctx),
      })
      .returning({ id: prayerCommitments.id });
    const generated = chain.status === 'active' ? await generateChainSlots(tx, chain, ctx.now) : null;
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.commitment_created',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { commitmentId: commitment!.id, personId: input.personId, rrule, localStartTime: input.localStartTime },
    });
    return {
      commitmentId: commitment!.id,
      assignmentsCreated: generated?.assignmentsCreated ?? 0,
      conflicts: (generated?.conflicts ?? []).filter((c) => c.commitmentId === commitment!.id),
    };
  });
}

/** Ends a commitment; its upcoming assignments that nobody acted on are cancelled. */
export async function endCommitment(db: Database, ctx: RequestContext, raw: unknown) {
  const { commitmentId } = parseInput(z.object({ commitmentId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    const [commitment] = await tx.select().from(prayerCommitments).where(eq(prayerCommitments.id, commitmentId)).for('update');
    if (!commitment || commitment.endedAt) throw notFound('commitment');
    await chainForActor(tx, ctx, 'prayer.assign', commitment.prayerChainId);

    await tx.update(prayerCommitments).set({ endedAt: ctx.now }).where(eq(prayerCommitments.id, commitment.id));
    const cancelled = await tx
      .update(prayerAssignments)
      .set({ status: 'cancelled', updatedAt: ctx.now })
      .where(
        and(
          eq(prayerAssignments.commitmentId, commitment.id),
          inArray(prayerAssignments.status, ['scheduled', 'confirmed']),
          gt(prayerAssignments.startsAt, ctx.now),
        ),
      )
      .returning({ id: prayerAssignments.id });
    if (cancelled.length > 0) {
      const ids = cancelled.map((a) => a.id);
      const actor = actorFromContext(ctx);
      await tx
        .update(actionTokens)
        .set({ revokedAt: ctx.now })
        .where(and(eq(actionTokens.purpose, 'prayer_assignment'), inArray(actionTokens.subjectId, ids), isNull(actionTokens.revokedAt)));
      await tx.insert(prayerAssignmentEvents).values(
        ids.map((assignmentId) => ({
          assignmentId,
          eventType: 'cancelled' as const,
          occurredAt: ctx.now,
          actorType: actor.type,
          actorUserId: actor.type === 'user' ? actor.userId : null,
          via: 'portal' as const,
          note: 'Standing commitment ended',
        })),
      );
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.commitment_ended',
      entityType: 'prayer_chain',
      entityId: commitment.prayerChainId,
      newValues: { commitmentId: commitment.id, cancelledAssignments: cancelled.length },
    });
    return { cancelledAssignments: cancelled.length };
  });
}
