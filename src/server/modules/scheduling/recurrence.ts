import { addDays } from '../journal/journal-dates';

/**
 * Recurrence rules for prayer and devotional schedules (docs/03 §4.11–4.12 `rrule`).
 *
 * A deliberately small, dependency-free subset of RFC 5545:
 * - `FREQ=DAILY`, with an optional `INTERVAL` of 1–4
 * - `FREQ=WEEKLY;BYDAY=MO,FR`, with an optional `INTERVAL` of 1–4
 * - `FREQ=MONTHLY` with `BYMONTHDAY=1`…`28` or `-1` (the last day), or `BYDAY=1SU`…`4SU` or `-1SU`
 *   (the first to fourth, or the last, weekday of the month), with an optional `INTERVAL` of 1–12
 *
 * Rules are evaluated on local calendar dates, so time zones never enter here. Intervals count from
 * the rule's effective start date: days from that date, weeks from the Monday of its week, months
 * from its month.
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MONTH_ORDINALS = [1, 2, 3, 4, -1] as const;
export type MonthOrdinal = (typeof MONTH_ORDINALS)[number];

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  /** WEEKLY: the days of the week (empty for the other frequencies). */
  byDay: Weekday[];
  /** MONTHLY only: a day of the month, 1–28, or -1 for the last day. */
  byMonthDay?: number;
  /** MONTHLY only: the nth weekday of the month, e.g. `{ ordinal: 1, day: 'SU' }` for the first Sunday. */
  byWeekday?: { ordinal: MonthOrdinal; day: Weekday };
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
  for (const key of values.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY'].includes(key)) return null;

  const freq = values.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  const interval = values.has('INTERVAL') ? Number(values.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > (freq === 'MONTHLY' ? 12 : 4)) return null;

  if (freq === 'MONTHLY') {
    const monthDay = values.get('BYMONTHDAY');
    const nthWeekday = values.get('BYDAY');
    if ((monthDay === undefined) === (nthWeekday === undefined)) return null; // exactly one of them
    if (monthDay !== undefined) {
      const day = Number(monthDay);
      if (!Number.isInteger(day) || !(day === -1 || (day >= 1 && day <= 28))) return null;
      return { freq, interval, byDay: [], byMonthDay: day };
    }
    const match = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/.exec(nthWeekday!);
    if (!match) return null;
    return { freq, interval, byDay: [], byWeekday: { ordinal: Number(match[1]) as MonthOrdinal, day: match[2] as Weekday } };
  }
  if (values.has('BYMONTHDAY')) return null;

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

/** Canonical text form, e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR` or `FREQ=MONTHLY;BYDAY=1SU`. */
export function formatRecurrence(rule: Recurrence): string {
  return [
    `FREQ=${rule.freq}`,
    rule.interval > 1 ? `INTERVAL=${rule.interval}` : null,
    rule.freq === 'WEEKLY' ? `BYDAY=${rule.byDay.join(',')}` : null,
    rule.freq === 'MONTHLY' && rule.byMonthDay !== undefined ? `BYMONTHDAY=${rule.byMonthDay}` : null,
    rule.freq === 'MONTHLY' && rule.byWeekday ? `BYDAY=${rule.byWeekday.ordinal}${rule.byWeekday.day}` : null,
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

/** The Monday of the week containing `date`. */
export const mondayOf = (date: string) => addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));

/** Whole weeks from the week of `from` to the week of `to` (negative when `to` is earlier). */
export const weeksBetween = (from: string, to: string) => Math.round((dayNumber(mondayOf(to)) - dayNumber(mondayOf(from))) / 7);

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether the rule occurs on `date`, counting intervals from `anchor` (the effective start date). */
export function occursOn(rule: Recurrence, date: string, anchor: string): boolean {
  if (date < anchor) return false;
  if (rule.freq === 'DAILY') return (dayNumber(date) - dayNumber(anchor)) % rule.interval === 0;
  if (rule.freq === 'WEEKLY') {
    if (!rule.byDay.includes(weekdayOf(date))) return false;
    return weeksBetween(anchor, date) % rule.interval === 0;
  }

  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [anchorYear, anchorMonth] = anchor.split('-').map(Number) as [number, number];
  if (((year - anchorYear) * 12 + (month - anchorMonth)) % rule.interval !== 0) return false;
  const lastDay = daysInMonth(year, month);
  if (rule.byMonthDay !== undefined) return rule.byMonthDay === -1 ? day === lastDay : day === rule.byMonthDay;
  if (!rule.byWeekday || weekdayOf(date) !== rule.byWeekday.day) return false;
  return rule.byWeekday.ordinal === -1 ? day + 7 > lastDay : Math.ceil(day / 7) === rule.byWeekday.ordinal;
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
const ordinalName = (ordinal: MonthOrdinal) => (ordinal === -1 ? 'last' : ['first', 'second', 'third', 'fourth'][ordinal - 1]!);
const dayOrdinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
};

/**
 * Plain language, e.g. "Every day", "Every Monday and Friday", "Every 2 weeks on Friday",
 * "Every month on the first Sunday".
 */
export function describeRecurrence(rule: Recurrence): string {
  if (rule.freq === 'DAILY') return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
  if (rule.freq === 'MONTHLY') {
    const when = rule.byWeekday
      ? `the ${ordinalName(rule.byWeekday.ordinal)} ${DAY_NAMES[rule.byWeekday.day]}`
      : rule.byMonthDay === -1
        ? 'the last day'
        : `the ${dayOrdinal(rule.byMonthDay ?? 1)}`;
    return rule.interval === 1 ? `Every month on ${when}` : `Every ${rule.interval} months on ${when}`;
  }
  if (rule.byDay.length === 7 && rule.interval === 1) return 'Every day';
  const days = joinNames(rule.byDay.map((d) => DAY_NAMES[d]));
  return rule.interval === 1 ? `Every ${days}` : `Every ${rule.interval} weeks on ${days}`;
}
