import { addDays } from '../journal/journal-dates';

/**
 * Recurrence rules for prayer schedules and commitments (docs/03 §4.11 `rrule`).
 *
 * A deliberately small, dependency-free subset of RFC 5545: `FREQ=DAILY` or `FREQ=WEEKLY` with
 * `BYDAY`, and an optional `INTERVAL` of 1–4. Rules are evaluated on chain-local calendar dates,
 * so time zones never enter here (slot-times.ts turns dates into instants). Intervals count
 * from the rule's effective start date (weekly intervals from the Monday of that week).
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  byDay: Weekday[];
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

export function parseRecurrence(rule: string): Recurrence | null {
  const parts = rule.trim().toUpperCase().split(';').filter(Boolean);
  if (parts.length === 0) return null;
  const values = new Map<string, string>();
  for (const part of parts) {
    const [key, value, extra] = part.split('=');
    if (!key || !value || extra !== undefined || values.has(key)) return null;
    values.set(key, value);
  }
  for (const key of values.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY'].includes(key)) return null;

  const freq = values.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return null;
  const interval = values.has('INTERVAL') ? Number(values.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 4) return null;

  let byDay: Weekday[] = [];
  if (values.has('BYDAY')) {
    const days = values.get('BYDAY')!.split(',');
    if (days.length === 0 || !days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return null;
    byDay = WEEKDAYS.filter((d) => days.includes(d));
  }
  if (freq === 'WEEKLY' && byDay.length === 0) return null;
  if (freq === 'DAILY' && byDay.length > 0) return null;
  return { freq, interval, byDay };
}

/** Canonical text form, e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR`. */
export function formatRecurrence(rule: Recurrence): string {
  return [
    `FREQ=${rule.freq}`,
    rule.interval > 1 ? `INTERVAL=${rule.interval}` : null,
    rule.freq === 'WEEKLY' ? `BYDAY=${rule.byDay.join(',')}` : null,
  ]
    .filter(Boolean)
    .join(';');
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function weekdayOf(date: string): Weekday {
  // 1970-01-01 was a Thursday (index 3 in Monday-first order).
  return WEEKDAYS[(((dayNumber(date) + 3) % 7) + 7) % 7]!;
}

const mondayOf = (date: string) => addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));

/** Whether the rule occurs on `date`, counting intervals from `anchor` (the effective start date). */
export function occursOn(rule: Recurrence, date: string, anchor: string): boolean {
  if (date < anchor) return false;
  if (rule.freq === 'DAILY') return (dayNumber(date) - dayNumber(anchor)) % rule.interval === 0;
  if (!rule.byDay.includes(weekdayOf(date))) return false;
  const weeks = Math.round((dayNumber(mondayOf(date)) - dayNumber(mondayOf(anchor))) / 7);
  return weeks % rule.interval === 0;
}

/** Dates in `range` on which the rule occurs, within its effective dates. */
export function expandDates(
  rule: Recurrence,
  range: { from: string; to: string },
  effective: { from: string; to: string | null },
): string[] {
  const start = range.from > effective.from ? range.from : effective.from;
  const end = effective.to !== null && effective.to < range.to ? effective.to : range.to;
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (occursOn(rule, d, effective.from)) dates.push(d);
  }
  return dates;
}

const joinNames = (names: string[]) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Plain language, e.g. "Every day", "Every Monday and Friday", "Every 2 weeks on Friday". */
export function describeRecurrence(rule: Recurrence): string {
  if (rule.freq === 'DAILY') return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
  if (rule.byDay.length === 7 && rule.interval === 1) return 'Every day';
  const days = joinNames(rule.byDay.map((d) => DAY_NAMES[d]));
  return rule.interval === 1 ? `Every ${days}` : `Every ${rule.interval} weeks on ${days}`;
}
