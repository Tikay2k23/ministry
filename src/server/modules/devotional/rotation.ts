import type { RotationMode } from '../../db/enums';
import { addDays } from '../journal/journal-dates';
import { expandDates, occursOn, parseRecurrence, weeksBetween } from '../scheduling/recurrence';

/**
 * Team rotation for devotional schedules (docs/05 W8 steps 3–4). Pure and browser-safe, so the
 * schedule form previews exactly what the generator creates.
 * - weekly: the week of the anchor date is position 0, the following week position 1, …
 * - per_occurrence: the first occurrence on or after the anchor is position 0, the next one 1, …
 */

export interface RotationSchedule {
  rrule: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rotationMode: RotationMode;
  rotationAnchor: string | null;
}

/** The rotation position of an occurrence date, before it is reduced to a team (negative before the anchor). */
export function rotationPosition(schedule: RotationSchedule, date: string): number {
  if (schedule.rotationMode === 'none' || !schedule.rotationAnchor) return 0;
  const anchor = schedule.rotationAnchor;
  if (schedule.rotationMode === 'weekly') return weeksBetween(anchor, date);

  const rule = parseRecurrence(schedule.rrule);
  if (!rule) return 0;
  const effective = { from: schedule.effectiveFrom, to: null };
  if (date >= anchor) return expandDates(rule, { from: anchor, to: addDays(date, -1) }, effective).length;
  return -expandDates(rule, { from: date, to: addDays(anchor, -1) }, effective).length;
}

/** Index into the schedule's rotation teams for an occurrence, or null when it has no team. */
export function teamIndexFor(schedule: RotationSchedule, teamCount: number, date: string): number | null {
  if (teamCount === 0) return null;
  if (schedule.rotationMode === 'none') return 0;
  const position = rotationPosition(schedule, date);
  return ((position % teamCount) + teamCount) % teamCount;
}

/** The next `count` occurrence dates from `from` (docs/04 A21: a preview of the next 6 with their teams). */
export function upcomingOccurrences(schedule: RotationSchedule, from: string, count: number, horizonDays = 400): string[] {
  const rule = parseRecurrence(schedule.rrule);
  if (!rule) return [];
  const dates: string[] = [];
  let date = from > schedule.effectiveFrom ? from : schedule.effectiveFrom;
  for (let i = 0; i <= horizonDays && dates.length < count; i += 1, date = addDays(date, 1)) {
    if (schedule.effectiveTo && date > schedule.effectiveTo) break;
    if (occursOn(rule, date, schedule.effectiveFrom)) dates.push(date);
  }
  return dates;
}
