import { z } from 'zod';
import { WEEKDAYS, type Weekday } from '@/server/modules/scheduling/recurrence';

/**
 * The schedule form's plain-language repeat choice (docs/04 A21: "Mon–Sat 6:00 AM", "first Sunday"),
 * turned into a recurrence rule (src/server/modules/scheduling/recurrence.ts).
 */

type AddIssue = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

export const REPEATS = ['daily', 'weekly', 'monthly'] as const;
export const MONTH_MODES = ['weekday', 'day'] as const;
export const ORDINALS = ['1', '2', '3', '4', '-1'] as const;

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

export const ORDINAL_NAMES: Record<(typeof ORDINALS)[number], string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' };

export const repeatChoiceShape = {
  repeat: z.enum(REPEATS),
  weekdays: z.array(z.enum(WEEKDAYS)),
  monthMode: z.enum(MONTH_MODES),
  ordinal: z.enum(ORDINALS),
  monthWeekday: z.enum(WEEKDAYS),
  monthDay: z.string().regex(/^(-1|[1-9]|1\d|2[0-8])$/, 'Choose a day of the month'),
};

export interface RepeatChoice {
  repeat: (typeof REPEATS)[number];
  weekdays: Weekday[];
  monthMode: (typeof MONTH_MODES)[number];
  ordinal: (typeof ORDINALS)[number];
  monthWeekday: Weekday;
  monthDay: string;
}

export function checkRepeatChoice(value: RepeatChoice, ctx: AddIssue) {
  if (value.repeat === 'weekly' && value.weekdays.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose at least one day.' });
  }
}

export function ruleForChoice(choice: Partial<RepeatChoice>): string {
  if (choice.repeat === 'weekly') return `FREQ=WEEKLY;BYDAY=${WEEKDAYS.filter((day) => (choice.weekdays ?? []).includes(day)).join(',')}`;
  if (choice.repeat === 'monthly') {
    return choice.monthMode === 'day'
      ? `FREQ=MONTHLY;BYMONTHDAY=${choice.monthDay ?? '1'}`
      : `FREQ=MONTHLY;BYDAY=${choice.ordinal ?? '1'}${choice.monthWeekday ?? 'SU'}`;
  }
  return 'FREQ=DAILY';
}

/** "Mon, Sep 21" for a calendar date. */
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
