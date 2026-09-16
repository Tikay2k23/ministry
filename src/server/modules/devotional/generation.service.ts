import { and, asc, eq, sql } from 'drizzle-orm';
import { newId } from '@/lib/ids';
import { queryRows, type Database, type Executor } from '../../db/client';
import { gatheringSchedules, gatheringScheduleTeams, gatheringTypes } from '../../db/schema';
import { addDays, localDate, zonedInstant } from '../journal/journal-dates';
import { expandDates, parseRecurrence } from '../scheduling/recurrence';
import { autoFillRoster } from './autofill';
import { ministryTimeZone, type GatheringTypeRow } from './common';
import { teamIndexFor } from './rotation';

/**
 * Gathering generation (docs/05 W8 step 4, docs/02 §7 `devotional.generate_gatherings`). For each
 * date in the schedule's rolling window without a gathering, the gathering is created with the
 * team whose turn it is, and its roster is filled. Gatherings are unique per (schedule, date), so
 * a gathering that exists — edited, published or cancelled — is never touched again (BR-D-03).
 */

const LOCK_NAMESPACE = 7501;

export type ScheduleRow = typeof gatheringSchedules.$inferSelect;

export interface GatheringGenerationResult {
  gatheringsCreated: number;
  assignmentsCreated: number;
  /** Required roster places left open. */
  gaps: number;
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** Creates the schedule's missing gatherings in its window and fills their rosters. Call inside a transaction. */
export async function generateScheduleGatherings(
  tx: Executor,
  schedule: ScheduleRow,
  type: GatheringTypeRow,
  now: Date,
  timeZone: string,
): Promise<GatheringGenerationResult> {
  const result: GatheringGenerationResult = { gatheringsCreated: 0, assignmentsCreated: 0, gaps: 0 };
  const rule = parseRecurrence(schedule.rrule);
  if (!schedule.isActive || !type.isActive || !rule) return result;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${schedule.id}))`);

  const today = localDate(now, timeZone);
  let to = addDays(today, schedule.generateDaysAhead);
  if (schedule.effectiveTo) to = earlier(to, schedule.effectiveTo);
  const from = later(today, schedule.effectiveFrom);
  if (from > to) return result;

  const rotation = await tx
    .select({ teamId: gatheringScheduleTeams.teamId })
    .from(gatheringScheduleTeams)
    .where(eq(gatheringScheduleTeams.scheduleId, schedule.id))
    .orderBy(asc(gatheringScheduleTeams.position));

  for (const date of expandDates(rule, { from, to }, { from: schedule.effectiveFrom, to: schedule.effectiveTo })) {
    const startsAt = zonedInstant(date, schedule.startTime.slice(0, 5), timeZone);
    const endsAt = new Date(startsAt.getTime() + schedule.durationMinutes * 60_000);
    if (endsAt <= now) continue;
    const index = teamIndexFor(schedule, rotation.length, date);
    const teamId = index === null ? null : rotation[index]!.teamId;

    const [created] = await queryRows<{ id: string }>(
      tx,
      sql`INSERT INTO gatherings (id, gathering_type_id, schedule_id, occurs_on, starts_at, ends_at, team_id)
          VALUES (${newId()}::uuid, ${type.id}::uuid, ${schedule.id}::uuid, ${date}::date,
                  ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, ${teamId}::uuid)
          ON CONFLICT (schedule_id, occurs_on) WHERE schedule_id IS NOT NULL DO NOTHING
          RETURNING id`,
    );
    if (!created) continue;
    result.gatheringsCreated += 1;
    const filled = await autoFillRoster(tx, { id: created.id, gatheringTypeId: type.id, teamId, startsAt, endsAt });
    result.assignmentsCreated += filled.assigned;
    result.gaps += filled.gaps.length;
  }
  return result;
}

/** The `devotional.generate_gatherings` job: every active schedule, one transaction each. */
export async function generateUpcomingGatherings(db: Database, now: Date) {
  const timeZone = await ministryTimeZone(db);
  const rows = await db
    .select({ schedule: gatheringSchedules, type: gatheringTypes })
    .from(gatheringSchedules)
    .innerJoin(gatheringTypes, eq(gatheringTypes.id, gatheringSchedules.gatheringTypeId))
    .where(and(eq(gatheringSchedules.isActive, true), eq(gatheringTypes.isActive, true)));

  const totals = { schedules: rows.length, gatheringsCreated: 0, assignmentsCreated: 0, gaps: 0 };
  for (const { schedule, type } of rows) {
    const result = await db.transaction((tx) => generateScheduleGatherings(tx, schedule, type, now, timeZone));
    totals.gatheringsCreated += result.gatheringsCreated;
    totals.assignmentsCreated += result.assignmentsCreated;
    totals.gaps += result.gaps;
  }
  return totals;
}
