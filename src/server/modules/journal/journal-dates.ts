/**
 * Journal date rules (docs/01 BR-J-01..03), all in the ministry timezone. Pure functions —
 * every time-dependent decision takes `now` explicitly so it can be tested at any instant.
 */

export interface JournalTimePolicy {
  deadlineTime: string; // "HH:MM" local
  lateCutoffTime: string; // "HH:MM" local, next morning
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date ("YYYY-MM-DD") of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local wall-clock time ("HH:MM") of an instant in a timezone. */
export function localTime(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which a local date and time occurs in a timezone (DST-safe). */
export function zonedInstant(date: string, time: string, timeZone: string, seconds = 0, millis = 0): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wallClock = Date.UTC(y, m - 1, d, hh, mm, seconds, millis);
  const first = offsetMs(new Date(wallClock), timeZone);
  let instant = wallClock - first;
  const second = offsetMs(new Date(instant), timeZone);
  if (second !== first) instant = wallClock - second;
  return new Date(instant);
}

/** A journal for `date` is on time until the end of the deadline minute on that date. */
export function deadlineInstant(date: string, timeZone: string, policy: JournalTimePolicy): Date {
  return zonedInstant(date, policy.deadlineTime, timeZone, 59, 999);
}

/** The day closes (not-yet → missed) at the late cutoff the next morning. */
export function closeInstant(date: string, timeZone: string, policy: JournalTimePolicy): Date {
  return zonedInstant(addDays(date, 1), policy.lateCutoffTime, timeZone);
}

/** Today, plus yesterday while its late window is still open. */
export function openJournalDates(now: Date, timeZone: string, policy: JournalTimePolicy): { today: string; yesterday: string | null } {
  const today = localDate(now, timeZone);
  const yesterday = addDays(today, -1);
  return { today, yesterday: now < closeInstant(yesterday, timeZone, policy) ? yesterday : null };
}

export function timingFor(date: string, submittedAt: Date, timeZone: string, policy: JournalTimePolicy): 'on_time' | 'late' {
  return submittedAt <= deadlineInstant(date, timeZone, policy) ? 'on_time' : 'late';
}
