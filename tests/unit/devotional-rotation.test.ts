import { describe, expect, it } from 'vitest';
import { rotationPosition, teamIndexFor, upcomingOccurrences, type RotationSchedule } from '@/server/modules/devotional/rotation';
import { describeRecurrence, expandDates, formatRecurrence, occursOn, parseRecurrence } from '@/server/modules/scheduling/recurrence';

describe('monthly recurrence rules', () => {
  it('parses nth-weekday and day-of-month rules and writes them back canonically', () => {
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=1SU')).toEqual({ freq: 'MONTHLY', interval: 1, byDay: [], byWeekday: { ordinal: 1, day: 'SU' } });
    expect(formatRecurrence(parseRecurrence('bymonthday=-1;freq=monthly;interval=2')!)).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1');
    for (const rule of ['FREQ=MONTHLY', 'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=MONTHLY;BYDAY=5SU', 'FREQ=MONTHLY;BYDAY=MO,TU', 'FREQ=MONTHLY;BYDAY=1SU;BYMONTHDAY=3', 'FREQ=WEEKLY;BYDAY=MO;BYMONTHDAY=1', 'FREQ=MONTHLY;BYMONTHDAY=1;INTERVAL=13']) {
      expect(parseRecurrence(rule), rule).toBeNull();
    }
  });

  it('finds the first Sunday, the last Friday and the last day of each month', () => {
    const firstSunday = parseRecurrence('FREQ=MONTHLY;BYDAY=1SU')!;
    expect(expandDates(firstSunday, { from: '2026-09-01', to: '2026-12-31' }, { from: '2026-09-01', to: null })).toEqual([
      '2026-09-06',
      '2026-10-04',
      '2026-11-01',
      '2026-12-06',
    ]);
    const lastFriday = parseRecurrence('FREQ=MONTHLY;BYDAY=-1FR')!;
    expect(expandDates(lastFriday, { from: '2026-09-01', to: '2026-11-30' }, { from: '2026-09-01', to: null })).toEqual(['2026-09-25', '2026-10-30', '2026-11-27']);
    const lastDay = parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1;INTERVAL=2')!;
    expect(occursOn(lastDay, '2026-09-30', '2026-09-01')).toBe(true);
    expect(occursOn(lastDay, '2026-10-31', '2026-09-01')).toBe(false); // every other month
    expect(occursOn(lastDay, '2026-11-30', '2026-09-01')).toBe(true);
  });

  it('describes monthly rules in plain language', () => {
    expect(describeRecurrence(parseRecurrence('FREQ=MONTHLY;BYDAY=1SU')!)).toBe('Every month on the first Sunday');
    expect(describeRecurrence(parseRecurrence('FREQ=MONTHLY;BYDAY=-1FR')!)).toBe('Every month on the last Friday');
    expect(describeRecurrence(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=22;INTERVAL=3')!)).toBe('Every 3 months on the 22nd');
    expect(describeRecurrence(parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1')!)).toBe('Every month on the last day');
  });
});

describe('team rotation', () => {
  // Monday to Saturday at 6:00 AM, as in docs/05 W8. 2026-09-21 is a Monday.
  const weekly: RotationSchedule = {
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA',
    effectiveFrom: '2026-09-21',
    effectiveTo: null,
    rotationMode: 'weekly',
    rotationAnchor: '2026-09-21',
  };

  it('gives each whole week to the next team, A → B → C → A', () => {
    const teams = (dates: string[]) => dates.map((date) => 'ABC'[teamIndexFor(weekly, 3, date)!]);
    expect(teams(['2026-09-21', '2026-09-26'])).toEqual(['A', 'A']);
    expect(teams(['2026-09-28', '2026-10-03'])).toEqual(['B', 'B']);
    expect(teams(['2026-10-05', '2026-10-12', '2026-10-19'])).toEqual(['C', 'A', 'B']);
    // Before the anchor week the rotation runs backwards.
    expect(rotationPosition(weekly, '2026-09-19')).toBe(-1);
    expect(teams(['2026-09-19'])).toEqual(['C']);
  });

  it('can rotate every occurrence, skipping days without one', () => {
    const everyTime: RotationSchedule = { ...weekly, rotationMode: 'per_occurrence', rotationAnchor: '2026-09-24' };
    const dates = upcomingOccurrences(everyTime, '2026-09-24', 5);
    expect(dates).toEqual(['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29']); // no Sunday
    expect(dates.map((date) => 'AB'[teamIndexFor(everyTime, 2, date)!])).toEqual(['A', 'B', 'A', 'B', 'A']);
    expect(teamIndexFor(everyTime, 2, '2026-09-23')).toBe(1);
  });

  it('keeps the same team without rotation, and has no team when none is chosen', () => {
    const fixed: RotationSchedule = { ...weekly, rotationMode: 'none', rotationAnchor: null };
    expect(teamIndexFor(fixed, 1, '2026-10-05')).toBe(0);
    expect(teamIndexFor(fixed, 0, '2026-10-05')).toBeNull();
  });

  it('stops previews at the end date', () => {
    expect(upcomingOccurrences({ ...weekly, effectiveTo: '2026-09-23' }, '2026-09-20', 6)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
  });
});
