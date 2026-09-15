import { z } from 'zod';

const isTimeZone = (tz: string) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC';

/**
 * Settings keys, their validation and defaults (docs/03 §4.1 "Settings keys").
 * Keys for later modules (journal.policy, prayer.defaults, …) are added with those modules.
 */
export const SETTINGS = {
  'ministry.profile': {
    schema: z.object({
      name: z.string().trim().min(1).max(120),
      shortName: z.string().trim().min(1).max(12),
      tagline: z.string().trim().max(120),
      timezone: z.string().refine(isTimeZone, 'Unknown timezone'),
      defaultCountry: z.string().length(2).toUpperCase(),
      locale: z.string().min(2).max(10),
    }),
    defaults: {
      name: 'Generation Touch Harvest International',
      shortName: 'GenTouch',
      tagline: "There's a Nation Inside of You!",
      timezone: 'Asia/Manila',
      defaultCountry: 'PH',
      locale: 'en-PH',
    },
  },
  'people.fields': {
    schema: z.object({
      collectGender: z.boolean(),
      collectAddress: z.boolean(),
      collectBirthYear: z.boolean(),
      ministryRequiredAtRegistration: z.boolean(),
    }),
    defaults: {
      collectGender: false,
      collectAddress: false,
      collectBirthYear: false,
      ministryRequiredAtRegistration: false,
    },
  },
  hierarchy: {
    schema: z.object({
      /** Depth of Primary Leaders in the tree (0 = they are the roots). */
      primaryLeaderDepth: z.int().min(0).max(10),
      /** Soft warning above this direct-group size. */
      groupSizeSoftLimit: z.int().min(1).max(200),
      /** Default status depth for Leader role assignments (null = whole downline). docs/06 note a. */
      leaderStatusDepth: z.int().min(1).max(50).nullable(),
    }),
    defaults: { primaryLeaderDepth: 1, groupSizeSoftLimit: 12, leaderStatusDepth: 1 },
  },
  'journal.policy': {
    schema: z
      .object({
        /** Local time by which a journal counts as on time (end of that minute). */
        deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        /** Local time next morning until which yesterday can still be sent (late); the day then closes. */
        lateCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        /** Whether a participant may edit their journal from the same device before the deadline. */
        editWindow: z.enum(['until_deadline', 'none']),
        /** How many levels above a person may read standard content (1 = direct leader only). docs/01 BR-J-06 */
        contentVisibilityDepth: z.int().min(1).max(10),
        /** Consecutive missed days that suggest a follow-up to the direct leader. */
        missedStreakThreshold: z.int().min(2).max(30),
        reviewExpected: z.boolean(),
        showStreaksToLeaders: z.boolean(),
      })
      .refine((p) => p.lateCutoffTime < '12:00', { path: ['lateCutoffTime'], message: 'Late cutoff must be before noon' }),
    defaults: {
      deadlineTime: '23:59',
      lateCutoffTime: '09:00',
      editWindow: 'until_deadline' as const,
      contentVisibilityDepth: 1,
      missedStreakThreshold: 3,
      reviewExpected: true,
      showStreaksToLeaders: true,
    },
  },
  'public.identification': {
    schema: z.object({
      /** Allow "mobile number + first name" recognition on a new device. */
      phoneMatchEnabled: z.boolean(),
      /** Bot challenge: off, only when risk signals appear, or always on registration. */
      challengeMode: z.enum(['off', 'risk_based', 'always']),
    }),
    defaults: { phoneMatchEnabled: true, challengeMode: 'risk_based' as const },
  },
  privacy: {
    schema: z.object({
      noticeVersion: z.string().min(1),
      minorsParticipate: z.boolean(),
      adultAge: z.int().min(13).max(21),
    }),
    defaults: { noticeVersion: '2026-09-01-draft', minorsParticipate: true, adultAge: 18 },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
