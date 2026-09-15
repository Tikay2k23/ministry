import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  expandDates,
  formatRecurrence,
  occursOn,
  parseRecurrence,
  weekdayOf,
} from '@/server/modules/prayer/recurrence';

describe('prayer recurrence rules', () => {
  it('parses the supported subset and writes it back canonically', () => {
    expect(parseRecurrence('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1, byDay: [] });
    expect(formatRecurrence(parseRecurrence('byday=fr,mo;freq=weekly')!)).toBe('FREQ=WEEKLY;BYDAY=MO,FR');
    expect(formatRecurrence(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU')!)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
  });

  it('rejects rules outside the subset', () => {
    for (const rule of [
      '',
      'FREQ=HOURLY',
      'FREQ=WEEKLY',
      'FREQ=DAILY;BYDAY=MO',
      'FREQ=DAILY;COUNT=3',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=DAILY;INTERVAL=5',
      'FREQ=WEEKLY;BYDAY=XX',
      'FREQ=DAILY;FREQ=WEEKLY',
    ]) {
      expect(parseRecurrence(rule), rule).toBeNull();
    }
  });

  it('knows the weekday of a date', () => {
    expect(weekdayOf('2026-09-15')).toBe('TU');
    expect(weekdayOf('2026-09-20')).toBe('SU');
    expect(weekdayOf('1970-01-01')).toBe('TH');
  });

  it('counts intervals from the effective start date', () => {
    const everyOtherDay = parseRecurrence('FREQ=DAILY;INTERVAL=2')!;
    expect(occursOn(everyOtherDay, '2026-09-15', '2026-09-15')).toBe(true);
    expect(occursOn(everyOtherDay, '2026-09-16', '2026-09-15')).toBe(false);
    expect(occursOn(everyOtherDay, '2026-09-17', '2026-09-15')).toBe(true);
    expect(occursOn(everyOtherDay, '2026-09-13', '2026-09-15')).toBe(false);

    // 2026-09-15 is a Tuesday; the Friday of that week is the 18th.
    const fortnightlyFriday = parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')!;
    expect(expandDates(fortnightlyFriday, { from: '2026-09-15', to: '2026-10-15' }, { from: '2026-09-15', to: null })).toEqual([
      '2026-09-18',
      '2026-10-02',
    ]);
  });

  it('stays within the effective dates', () => {
    const daily = parseRecurrence('FREQ=DAILY')!;
    expect(expandDates(daily, { from: '2026-09-10', to: '2026-09-20' }, { from: '2026-09-15', to: '2026-09-17' })).toEqual([
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ]);
  });

  it('describes rules in plain language', () => {
    expect(describeRecurrence(parseRecurrence('FREQ=DAILY')!)).toBe('Every day');
    expect(describeRecurrence(parseRecurrence('FREQ=DAILY;INTERVAL=3')!)).toBe('Every 3 days');
    expect(describeRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=TU')!)).toBe('Every Tuesday');
    expect(describeRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR')!)).toBe('Every Monday, Wednesday and Friday');
    expect(describeRecurrence(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')!)).toBe('Every 2 weeks on Friday');
  });
});
