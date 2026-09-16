import { z } from 'zod';
import { formatClockTime } from '@/lib/time-range';
import {
  ROTATION_MODES,
  SERVING_ROLE_CATEGORIES,
  type GatheringAssignmentStatus,
  type RotationMode,
  type ServingRoleCategory,
} from '../../db/enums';
import { describeRecurrence, parseRecurrence } from '../scheduling/recurrence';

/**
 * Devotional input schemas and plain-language labels, shared by the services (which stay the
 * authority) and the portal forms in the browser (React Hook Form). This file ships to the
 * browser, so it must not import anything server-only.
 */

type AddIssue = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

const emptyToNull = (value: unknown) => (value === '' ? null : value);
const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 06:00');

export const SERVING_CATEGORY_LABELS: Record<ServingRoleCategory, string> = {
  music: 'Music',
  word: 'Word',
  prayer: 'Prayer',
  production: 'Production',
  hosting: 'Hosting',
  other: 'Other',
};

export const ROTATION_LABELS: Record<RotationMode, string> = {
  none: 'No rotation',
  per_occurrence: 'A different team each time',
  weekly: 'A different team each week',
};

export const ASSIGNMENT_STATUS_LABELS: Record<GatheringAssignmentStatus, string> = {
  pending: 'Waiting for reply',
  confirmed: 'Confirmed',
  declined: 'Can’t serve',
  replaced: 'Replaced',
  cancelled: 'Removed',
};

/** "60 minutes", "1 hour", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "Every Monday, … and Saturday · 6:00 AM for 1 hour". */
export function describeGatheringSchedule(schedule: { rrule: string; startTime: string; durationMinutes: number }): string {
  const rule = parseRecurrence(schedule.rrule);
  return `${rule ? describeRecurrence(rule) : 'Custom pattern'} · ${formatClockTime(schedule.startTime)} for ${formatMinutes(schedule.durationMinutes)}`;
}

// ─── Serving roles (FR-DEV-02) ────────────────────────────────────────────────

export const ServingRoleInput = z.object({
  name: z.string().trim().min(1, 'Name the role').max(60),
  category: z.enum(SERVING_ROLE_CATEGORIES),
});

export const UpdateServingRoleInput = ServingRoleInput.extend({
  servingRoleId: z.uuid(),
  isActive: z.boolean(),
});

// ─── Gathering types and their roster template (FR-DEV-01) ────────────────────

export const gatheringTypeShape = {
  name: z.string().trim().min(1, 'Name the gathering').max(80),
  defaultStartTime: timeOfDay,
  defaultDurationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  ministryId: z.preprocess(emptyToNull, z.uuid().nullish()),
  responseLockHours: z.coerce.number().int().min(0).max(168),
};

export const CreateGatheringTypeInput = z.object(gatheringTypeShape);

export const UpdateGatheringTypeInput = z.object({ gatheringTypeId: z.uuid(), ...gatheringTypeShape, isActive: z.boolean() });

export const TemplateRoleInput = z
  .object({
    servingRoleId: z.uuid(),
    minCount: z.coerce.number().int().min(0).max(20),
    maxCount: z.coerce.number().int().min(1).max(20),
  })
  .refine((role) => role.maxCount >= role.minCount, { path: ['maxCount'], message: 'At least the number needed' });

export const RosterTemplateInput = z
  .object({ gatheringTypeId: z.uuid(), roles: z.array(TemplateRoleInput).max(60) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.roles.forEach((role, index) => {
      if (seen.has(role.servingRoleId)) {
        ctx.addIssue({ code: 'custom', path: ['roles', index, 'servingRoleId'], message: 'This role is already in the list.' });
      }
      seen.add(role.servingRoleId);
    });
  });

// ─── Schedules with team rotation (FR-DEV-04, docs/05 W8 step 3) ──────────────

export const scheduleShape = {
  gatheringTypeId: z.uuid(),
  name: z.string().trim().min(1, 'Name the schedule').max(80),
  rrule: z
    .string()
    .trim()
    .max(200)
    .refine((rule) => parseRecurrence(rule) !== null, 'Choose how often it repeats'),
  startTime: timeOfDay,
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.preprocess(emptyToNull, z.iso.date().nullish()),
  rotationMode: z.enum(ROTATION_MODES),
  /** In rotation order (A → B → C). Without rotation: one team, or none. */
  teamIds: z.array(z.uuid()).max(12),
  rotationAnchor: z.preprocess(emptyToNull, z.iso.date().nullish()),
  generateDaysAhead: z.coerce.number().int().min(1).max(180),
};

type ScheduleValues = {
  effectiveFrom: string;
  effectiveTo?: string | null;
  rotationMode: RotationMode;
  teamIds: string[];
  rotationAnchor?: string | null;
};

export function checkScheduleValues(value: ScheduleValues, ctx: AddIssue) {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  }
  if (value.rotationMode === 'none') {
    if (value.teamIds.length > 1) ctx.addIssue({ code: 'custom', path: ['teamIds'], message: 'Choose one team, or rotate between teams.' });
    return;
  }
  if (value.teamIds.length < 2) ctx.addIssue({ code: 'custom', path: ['teamIds'], message: 'Choose at least two teams to rotate.' });
  if (!value.rotationAnchor) ctx.addIssue({ code: 'custom', path: ['rotationAnchor'], message: 'Choose when the first team serves.' });
}

export const CreateScheduleInput = z.object(scheduleShape).superRefine(checkScheduleValues);

// ─── Gatherings and rosters (docs/04 A20) ─────────────────────────────────────

export const OneOffGatheringInput = z.object({
  gatheringTypeId: z.uuid(),
  date: z.iso.date(),
  startTime: timeOfDay,
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  teamId: z.preprocess(emptyToNull, z.uuid().nullish()),
  title: optionalText(120),
});

export const UpdateGatheringInput = z.object({
  gatheringId: z.uuid(),
  title: optionalText(120),
  notes: optionalText(2000),
});

export const CancelGatheringInput = z.object({
  gatheringId: z.uuid(),
  reason: z.string().trim().min(3, 'Please give a short reason').max(300),
});

export const PublishRostersInput = z.object({
  gatheringIds: z.array(z.uuid()).min(1).max(62),
  /** Publish even when required roles are still open. */
  force: z.boolean().default(false),
});

export const AssignServingInput = z.object({ gatheringId: z.uuid(), servingRoleId: z.uuid(), personId: z.uuid() });

export const SubstituteServingInput = z.object({ assignmentId: z.uuid(), personId: z.uuid() });

// ─── Teams and availability ───────────────────────────────────────────────────

export const MemberRolesInput = z
  .object({
    teamMembershipId: z.uuid(),
    servingRoleIds: z.array(z.uuid()).max(20),
    primaryRoleId: z.preprocess(emptyToNull, z.uuid().nullish()),
  })
  .refine((value) => !value.primaryRoleId || value.servingRoleIds.includes(value.primaryRoleId), {
    path: ['primaryRoleId'],
    message: 'The main role must be one of their roles.',
  });

export const UnavailabilityInput = z
  .object({
    personId: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
    reason: optionalText(200),
  })
  .refine((value) => value.to >= value.from, { path: ['to'], message: 'The last day must be on or after the first day.' });
