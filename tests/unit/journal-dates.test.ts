import { describe, expect, it } from 'vitest';
import {
  addDays,
  closeInstant,
  daysBetween,
  deadlineInstant,
  localDate,
  localTime,
  openJournalDates,
  timingFor,
  zonedInstant,
} from '@/server/modules/journal/journal-dates';

const MANILA = 'Asia/Manila'; // UTC+8, no daylight saving
const POLICY = { deadlineTime: '23:59', lateCutoffTime: '09:00' };

describe('journal dates (Asia/Manila)', () => {
  it('uses the local calendar date, not UTC', () => {
    // 2026-09-12 17:30 UTC is 01:30 on the 13th in Manila.
    const instant = new Date('2026-09-12T17:30:00Z');
    expect(localDate(instant, MANILA)).toBe('2026-09-13');
    expect(localTime(instant, MANILA)).toBe('01:30');
  });

  it('computes the deadline and the close of a day', () => {
    expect(deadlineInstant('2026-09-12', MANILA, POLICY).toISOString()).toBe('2026-09-12T15:59:59.999Z');
    expect(closeInstant('2026-09-12', MANILA, POLICY).toISOString()).toBe('2026-09-13T01:00:00.000Z');
  });

  it('offers yesterday only during the late window after midnight (BR-J-02)', () => {
    const afterMidnight = zonedInstant('2026-09-13', '00:30', MANILA);
    expect(openJournalDates(afterMidnight, MANILA, POLICY)).toEqual({ today: '2026-09-13', yesterday: '2026-09-12' });

    const justBeforeCutoff = zonedInstant('2026-09-13', '08:59', MANILA, 59);
    expect(openJournalDates(justBeforeCutoff, MANILA, POLICY).yesterday).toBe('2026-09-12');

    const atCutoff = zonedInstant('2026-09-13', '09:00', MANILA);
    expect(openJournalDates(atCutoff, MANILA, POLICY)).toEqual({ today: '2026-09-13', yesterday: null });
  });

  it('marks submissions after the deadline as late', () => {
    expect(timingFor('2026-09-12', zonedInstant('2026-09-12', '23:59', MANILA, 30), MANILA, POLICY)).toBe('on_time');
    expect(timingFor('2026-09-12', zonedInstant('2026-09-13', '00:10', MANILA), MANILA, POLICY)).toBe('late');
  });

  it('does calendar arithmetic across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-01', '2026-09-12')).toBe(11);
  });
});

describe('journal dates across daylight saving (ministries abroad)', () => {
  const NEW_YORK = 'America/New_York';

  it('converts local times correctly on both sides of a DST change', () => {
    // 2026-03-08: clocks jump from 02:00 to 03:00 in New York.
    expect(zonedInstant('2026-03-07', '09:00', NEW_YORK).toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST (UTC-5)
    expect(zonedInstant('2026-03-09', '09:00', NEW_YORK).toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT (UTC-4)
    expect(closeInstant('2026-03-07', NEW_YORK, POLICY).toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});
