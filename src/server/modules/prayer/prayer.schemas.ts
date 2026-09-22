import { z } from 'zod';
import { formatClockTime } from '@/lib/time-range';
import { PRAYER_CHAIN_TYPES } from '../../db/enums';
import { describeRecurrence, parseRecurrence } from './recurrence';
import { isValidTimeZone } from './slot-times';

/**
 * Prayer chain input schemas and plain-language descriptions, shared by the services (which stay
 * the authority) and the portal forms in the browser (React Hook Form). This file ships to the
 * browser, so it must not import anything server-only.
 */

type AddIssue = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

const emptyToNull = (value: unknown) => (value === '' ? null : value);

export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 06:00');

const recurrenceRule = (message: string) =>
  z
    .string()
    .trim()
    .max(200)
    .refine((rule) => parseRecurrence(rule) !== null, message);

// ─── Schedules (docs/04 A18) ──────────────────────────────────────────────────

export const scheduleShape = {
  rrule: recurrenceRule('Choose how often it repeats'),
  firstSlotTime: timeOfDay,
  slotMinutes: z.coerce.number().int().min(5, 'Slots are at least 5 minutes').max(1440),
  slotsPerOccurrence: z.coerce.number().int().min(1).max(288),
  capacity: z.coerce.number().int().min(1).max(50).default(1),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.preprocess(emptyToNull, z.iso.date().nullish()),
  generateDaysAhead: z.coerce.number().int().min(1).max(90).default(14),
};

type ScheduleValues = { slotMinutes: number; slotsPerOccurrence: number; effectiveFrom: string; effectiveTo?: string | null };

export function checkScheduleValues(value: ScheduleValues, ctx: AddIssue) {
  if (value.slotMinutes * value.slotsPerOccurrence > 1440) {
    ctx.addIssue({ code: 'custom', path: ['slotsPerOccurrence'], message: 'One occurrence can be at most 24 hours long.' });
  }
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  }
}

export const AddScheduleInput = z.object({ chainId: z.uuid(), ...scheduleShape }).superRefine(checkScheduleValues);

export interface ScheduleLike {
  rrule: string;
  firstSlotTime: string;
  slotMinutes: number;
  slotsPerOccurrence: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** "Every day · 24 slots of 60 minutes from 12:00 AM" */
export function describeSchedule(schedule: Pick<ScheduleLike, 'rrule' | 'firstSlotTime' | 'slotMinutes' | 'slotsPerOccurrence'>): string {
  const rule = parseRecurrence(schedule.rrule);
  const repeat = rule ? describeRecurrence(rule) : 'Custom pattern';
  const slots =
    schedule.slotsPerOccurrence === 1
      ? `one ${schedule.slotMinutes}-minute slot`
      : `${schedule.slotsPerOccurrence} slots of ${schedule.slotMinutes} minutes`;
  return `${repeat} · ${slots} from ${formatClockTime(schedule.firstSlotTime)}`;
}

// ─── Chains (docs/05 W10) ─────────────────────────────────────────────────────

export const chainShape = {
  name: z.string().trim().min(1, 'Name the prayer chain').max(120),
  description: optionalText(1000),
  chainType: z.enum(PRAYER_CHAIN_TYPES),
  timezone: z.string().trim().refine(isValidTimeZone, 'Choose a valid time zone'),
  ministryId: z.preprocess(emptyToNull, z.uuid().nullish()),
  startsOn: z.iso.date(),
  endsOn: z.preprocess(emptyToNull, z.iso.date().nullish()),
  graceMinutes: z.coerce.number().int().min(0).max(240).default(15),
  checkinOpensMinutes: z.coerce.number().int().min(0).max(120).default(15),
  requireCheckin: z.boolean().default(false),
  showNamesPublicly: z.boolean().default(false),
  /** People may take an open hour themselves from the chain page, rather than waiting to be asked. */
  allowSelfSignup: z.boolean().default(false),
  collectReports: z.boolean().default(true),
};

export function checkChainDates(value: { startsOn: string; endsOn?: string | null }, ctx: AddIssue) {
  if (value.endsOn && value.endsOn < value.startsOn) {
    ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The end date must be on or after the start date.' });
  }
}

export const CreateChainInput = z
  .object({ ...chainShape, schedule: z.object(scheduleShape).superRefine(checkScheduleValues) })
  .superRefine(checkChainDates);

export const UpdateChainInput = z.object({ chainId: z.uuid(), ...chainShape }).superRefine(checkChainDates);

// ─── Standing commitments (docs/05 W11) ───────────────────────────────────────

export const CommitmentInput = z
  .object({
    chainId: z.uuid(),
    personId: z.uuid(),
    rrule: recurrenceRule('Choose the days'),
    localStartTime: timeOfDay,
    effectiveFrom: z.iso.date(),
    effectiveTo: z.preprocess(emptyToNull, z.iso.date().nullish()),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
    }
  });
