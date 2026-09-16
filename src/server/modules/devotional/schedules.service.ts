import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { gatheringSchedules, gatheringScheduleTeams, gatherings, gatheringTypes, teams } from '../../db/schema';
import { invalidState, notFound, validationError } from '../../errors';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { localDate } from '../journal/journal-dates';
import { formatRecurrence, parseRecurrence } from '../scheduling/recurrence';
import { gatheringTypeForActor, ministryTimeZone } from './common';
import { CreateScheduleInput } from './devotional.schemas';
import { generateScheduleGatherings } from './generation.service';
import { cancelGatheringsInTx } from './roster.service';

/** Devotional schedules with team rotation (FR-DEV-04, docs/05 W8 steps 3–4, docs/04 A21). */

export async function createGatheringSchedule(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateScheduleInput, raw);
  return db.transaction(async (tx) => {
    const type = await gatheringTypeForActor(tx, ctx, 'devotional.manage', input.gatheringTypeId, { forUpdate: true });
    if (!type.isActive) throw invalidState('This kind of gathering is no longer in use.');
    const teamIds = [...new Set(input.teamIds)];
    if (teamIds.length > 0) {
      const found = await tx.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, teamIds), isNull(teams.archivedAt)));
      if (found.length !== teamIds.length) throw validationError({ teamIds: ['Choose active teams.'] });
    }

    const [schedule] = await tx
      .insert(gatheringSchedules)
      .values({
        gatheringTypeId: type.id,
        name: input.name,
        rrule: formatRecurrence(parseRecurrence(input.rrule)!),
        startTime: `${input.startTime}:00`,
        durationMinutes: input.durationMinutes,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        rotationMode: input.rotationMode,
        rotationAnchor: input.rotationMode === 'none' ? null : (input.rotationAnchor ?? null),
        generateDaysAhead: input.generateDaysAhead,
        createdBy: actorUserId(ctx),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (input.teamIds.length > 0) {
      await tx.insert(gatheringScheduleTeams).values(input.teamIds.map((teamId, position) => ({ scheduleId: schedule!.id, position, teamId })));
    }
    const generated = await generateScheduleGatherings(tx, schedule!, type, ctx.now, await ministryTimeZone(tx));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.schedule_created',
      entityType: 'gathering_type',
      entityId: type.id,
      newValues: { scheduleId: schedule!.id, name: input.name, rrule: schedule!.rrule, rotationMode: input.rotationMode, teams: input.teamIds.length },
    });
    return { scheduleId: schedule!.id, generated };
  });
}

/** Stops a schedule: nothing new is generated, and its upcoming gatherings are cancelled (BR-D-05). */
export async function endGatheringSchedule(db: Database, ctx: RequestContext, raw: unknown) {
  const { scheduleId } = parseInput(z.object({ scheduleId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    const [schedule] = await tx.select().from(gatheringSchedules).where(eq(gatheringSchedules.id, scheduleId)).for('update');
    if (!schedule) throw notFound('schedule');
    const type = await gatheringTypeForActor(tx, ctx, 'devotional.manage', schedule.gatheringTypeId);
    if (!schedule.isActive) throw invalidState('This schedule has already ended.');

    const today = localDate(ctx.now, await ministryTimeZone(tx));
    const effectiveTo = schedule.effectiveFrom > today ? schedule.effectiveFrom : schedule.effectiveTo && schedule.effectiveTo < today ? schedule.effectiveTo : today;
    await tx.update(gatheringSchedules).set({ isActive: false, effectiveTo, updatedAt: ctx.now }).where(eq(gatheringSchedules.id, schedule.id));

    const upcoming = await tx
      .select({ gathering: gatherings, type: gatheringTypes })
      .from(gatherings)
      .innerJoin(gatheringTypes, eq(gatheringTypes.id, gatherings.gatheringTypeId))
      .where(and(eq(gatherings.scheduleId, schedule.id), eq(gatherings.status, 'scheduled'), gt(gatherings.startsAt, ctx.now)))
      .for('update', { of: gatherings });
    const cancelled = await cancelGatheringsInTx(tx, ctx, upcoming, 'This schedule has ended');
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.schedule_ended',
      entityType: 'gathering_type',
      entityId: type.id,
      newValues: { scheduleId: schedule.id, effectiveTo, cancelledGatherings: cancelled.gatherings },
    });
    return cancelled;
  });
}
