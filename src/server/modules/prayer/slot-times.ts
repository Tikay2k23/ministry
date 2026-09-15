import { localDate, localTime, zonedInstant } from '../journal/journal-dates';

/**
 * Turning a schedule occurrence (a chain-local date) into slot instants. Times are computed from
 * the first slot's local wall-clock time and then advanced in real minutes, so slot lengths are
 * exact even across daylight-saving changes. Each slot belongs to the chain date of its own
 * start (BR-PR-06), so slots after midnight fall on the next date.
 */

export interface SlotPattern {
  /** "HH:MM" or "HH:MM:SS" (PostgreSQL `time`). */
  firstSlotTime: string;
  slotMinutes: number;
  slotsPerOccurrence: number;
}

export interface SlotTime {
  startsAt: Date;
  endsAt: Date;
  chainDate: string;
}

export function slotsForOccurrence(date: string, pattern: SlotPattern, timeZone: string): SlotTime[] {
  const first = zonedInstant(date, pattern.firstSlotTime.slice(0, 5), timeZone);
  const minutes = pattern.slotMinutes * 60_000;
  return Array.from({ length: pattern.slotsPerOccurrence }, (_, i) => {
    const startsAt = new Date(first.getTime() + i * minutes);
    return { startsAt, endsAt: new Date(startsAt.getTime() + minutes), chainDate: localDate(startsAt, timeZone) };
  });
}

/** Chain-local "HH:MM" of an instant (used to match standing commitments to slots). */
export const chainLocalTime = (instant: Date, timeZone: string) => localTime(instant, timeZone);

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}
