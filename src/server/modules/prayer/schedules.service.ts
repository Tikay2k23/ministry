import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { formatClockTime, formatSlotRange } from '@/lib/time-range';
import type { RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { prayerChainSchedules } from '../../db/schema';
import { invalidState, notFound, validationError } from '../../errors';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { addDays } from '../journal/journal-dates';
import { actorFromContext, chainForActor, chainToday, later, timeOfDay } from './common';
import { cancelUpcomingSlots, generateChainSlots } from './generation.service';
import { describeRecurrence, expandDates, formatRecurrence, parseRecurrence } from './recurrence';
import { slotsForOccurrence, type SlotTime } from './slot-times';

/** Slot patterns for a chain (docs/04 A18, docs/02a `prayer.schedules.upsert`). */

const OVERLAP_CHECK_DAYS = 60;

export const scheduleShape = {
  rrule: z
    .string()
    .trim()
    .max(200)
    .refine((rule) => parseRecurrence(rule) !== null, 'Choose how often it repeats'),
  firstSlotTime: timeOfDay,
  slotMinutes: z.coerce.number().int().min(5, 'Slots are at least 5 minutes').max(1440),
  slotsPerOccurrence: z.coerce.number().int().min(1).max(288),
  capacity: z.coerce.number().int().min(1).max(50).default(1),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullish(),
  generateDaysAhead: z.coerce.number().int().min(1).max(90).default(14),
};

type ScheduleValues = { slotMinutes: number; slotsPerOccurrence: number; effectiveFrom: string; effectiveTo?: string | null };

export function checkScheduleValues(value: ScheduleValues, ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void }) {
  if (value.slotMinutes * value.slotsPerOccurrence > 1440) {
    ctx.addIssue({ code: 'custom', path: ['slotsPerOccurrence'], message: 'One occurrence can be at most 24 hours long.' });
  }
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  }
}

export interface ScheduleLike {
  rrule: string;
  firstSlotTime: string;
  slotMinutes: number;
  slotsPerOccurrence: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** The first slot that would overlap another when all schedules are expanded over `range` (pure). */
export function findScheduleOverlap(schedules: ScheduleLike[], range: { from: string; to: string }, timeZone: string): SlotTime | null {
  const slots = schedules
    .flatMap((schedule) => {
      const rule = parseRecurrence(schedule.rrule);
      if (!rule) return [];
      return expandDates(rule, range, { from: schedule.effectiveFrom, to: schedule.effectiveTo }).flatMap((date) =>
        slotsForOccurrence(date, schedule, timeZone),
      );
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let latestEnd = 0;
  for (const slot of slots) {
    if (slot.startsAt.getTime() < latestEnd) return slot;
    latestEnd = Math.max(latestEnd, slot.endsAt.getTime());
  }
  return null;
}

/** "Every day · 24 slots of 60 minutes from 12:00 AM" */
export function describeSchedule(schedule: Pick<ScheduleLike, 'rrule' | 'firstSlotTime' | 'slotMinutes' | 'slotsPerOccurrence'>): string {
  const rule = parseRecurrence(schedule.rrule);
  const repeat = rule ? describeRecurrence(rule) : 'Custom pattern';
  const slots =
    schedule.slotsPerOccurrence === 1
      ? `one ${schedule.slotMinutes}-minute slot`
      : `${schedule.slotsPerOccurrence} slots of ${schedule.slotMinutes} minutes`;
  return `${repeat} · ${slots} from ${formatClockTime(schedule.firstSlotTime)}`;
}

export const AddScheduleInput = z.object({ chainId: z.uuid(), ...scheduleShape }).superRefine(checkScheduleValues);

export async function addSchedule(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AddScheduleInput, raw);
  return db.transaction(async (tx) => {
    const chain = await chainForActor(tx, ctx, 'prayer.manage', input.chainId, { forUpdate: true });
    if (chain.status === 'ended') throw invalidState('This prayer chain has ended.');

    const candidate: ScheduleLike = {
      rrule: formatRecurrence(parseRecurrence(input.rrule)!),
      firstSlotTime: input.firstSlotTime,
      slotMinutes: input.slotMinutes,
      slotsPerOccurrence: input.slotsPerOccurrence,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
    };
    const existing = await tx.select().from(prayerChainSchedules).where(eq(prayerChainSchedules.prayerChainId, chain.id));
    const from = later(chainToday(chain, ctx.now), input.effectiveFrom);
    const clash = findScheduleOverlap([...existing, candidate], { from, to: addDays(from, OVERLAP_CHECK_DAYS) }, chain.timezone);
    if (clash) {
      throw validationError({
        firstSlotTime: [`These slots would overlap another schedule, for example ${formatSlotRange(clash.startsAt, clash.endsAt, chain.timezone, { withDate: true })}.`],
      });
    }

    const [schedule] = await tx
      .insert(prayerChainSchedules)
      .values({
        prayerChainId: chain.id,
        ...candidate,
        firstSlotTime: `${input.firstSlotTime}:00`,
        capacity: input.capacity,
        generateDaysAhead: input.generateDaysAhead,
      })
      .returning({ id: prayerChainSchedules.id });
    const generated = chain.status === 'active' ? await generateChainSlots(tx, chain, ctx.now) : null;
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.schedule_added',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { scheduleId: schedule!.id, ...candidate, capacity: input.capacity },
    });
    return { scheduleId: schedule!.id, generated };
  });
}

/** Stops a schedule from today: no new slots, and its upcoming slots are cancelled. */
export async function endSchedule(db: Database, ctx: RequestContext, raw: unknown) {
  const { scheduleId } = parseInput(z.object({ scheduleId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    const [schedule] = await tx.select().from(prayerChainSchedules).where(eq(prayerChainSchedules.id, scheduleId)).for('update');
    if (!schedule) throw notFound('schedule');
    const chain = await chainForActor(tx, ctx, 'prayer.manage', schedule.prayerChainId);

    const yesterday = addDays(chainToday(chain, ctx.now), -1);
    const effectiveTo = later(schedule.effectiveFrom, yesterday);
    if (schedule.effectiveTo !== null && schedule.effectiveTo <= effectiveTo) throw invalidState('This schedule has already ended.');
    await tx.update(prayerChainSchedules).set({ effectiveTo, updatedAt: ctx.now }).where(eq(prayerChainSchedules.id, schedule.id));
    const cancelled = await cancelUpcomingSlots(tx, {
      chainId: chain.id,
      scheduleId: schedule.id,
      now: ctx.now,
      actor: actorFromContext(ctx),
      reason: 'Schedule ended',
    });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.schedule_ended',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { scheduleId: schedule.id, effectiveTo, ...cancelled },
    });
    return cancelled;
  });
}
