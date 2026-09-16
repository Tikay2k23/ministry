/**
 * Allowed values for text columns with CHECK constraints.
 * Single source of truth for the database schema, Zod validators and UI labels.
 * See docs/03-database.md §1 (text + CHECK for fixed state machines).
 */

export const GENDERS = ['male', 'female'] as const;
export const PERSON_STATUSES = ['active', 'inactive'] as const;
export const REGISTRATION_STATUSES = ['unconfirmed', 'confirmed', 'rejected'] as const;
export const PERSON_SOURCES = ['portal', 'import', 'public_registration'] as const;
export const ARCHIVE_REASONS = ['left', 'moved', 'deceased', 'duplicate', 'anonymised', 'other'] as const;
export const DUPLICATE_STATUSES = ['open', 'merged', 'not_duplicate'] as const;

export const LEADER_CHANGE_SOURCES = ['public_form', 'portal', 'registration_correction'] as const;
export const LEADER_CHANGE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'superseded'] as const;
export const LEADERSHIP_CHANGE_TYPES = ['placed', 'moved', 'removed', 'group_reassigned'] as const;

export const TEAM_TYPES = ['general', 'worship', 'prayer', 'production', 'hospitality'] as const;
export const MINISTRY_POSITIONS = ['member', 'worker', 'assistant_head', 'head'] as const;
export const TEAM_MEMBER_ROLES = ['lead', 'assistant', 'member'] as const;

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;
export const SCOPE_TYPES = ['global', 'branch', 'ministry', 'team', 'prayer_chain', 'gathering_type'] as const;

export const AUDIT_CATEGORIES = ['change', 'access', 'auth', 'security', 'system'] as const;
export const ACTOR_TYPES = ['user', 'participant', 'system'] as const;

export const IMPORT_KINDS = ['people_hierarchy'] as const;
export const IMPORT_STATUSES = [
  'uploaded',
  'validating',
  'previewed',
  'committing',
  'completed',
  'failed',
  'cancelled',
] as const;
export const IMPORT_ROW_OUTCOMES = [
  'valid',
  'warning',
  'error',
  'duplicate_candidate',
  'imported',
  'skipped',
] as const;

// ─── M2: calendar, forms, journal, care, public access ───────────────────────
export const CALENDAR_DAY_KINDS = ['journal_rest_day', 'holiday', 'special'] as const;
export const FORM_PURPOSES = ['journal', 'prayer_report', 'general'] as const;
export const FORM_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export const FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'yes_no',
  'single_choice',
  'multi_choice',
  'number',
  'scripture_ref',
  'prayer_request',
  'testimony',
  'reflection',
  'gratitude',
  'date',
  'time',
] as const;
export const SENSITIVITIES = ['standard', 'restricted', 'confidential'] as const;
/** How the participant's identity was established for a submission. */
export const JOURNAL_CHANNELS = ['registration', 'phone_match', 'personal_link', 'otp', 'proxy'] as const;
export const JOURNAL_TIMINGS = ['on_time', 'late'] as const;
export const SUBMISSION_STATUSES = ['pending', 'submitted', 'late', 'missed', 'excused'] as const;
export const REVIEW_STATUSES = ['none', 'awaiting', 'reviewed'] as const;
export const DAY_CARE_STATUSES = ['none', 'needs_follow_up', 'resolved'] as const;
export const EXCUSE_REASONS = ['rest_day', 'pause', 'leader_excused', 'admin_excused'] as const;
export const PAUSE_REASONS = ['leave', 'sickness', 'travel', 'bereavement', 'other'] as const;
export const CARE_KINDS = [
  'journal_missed_streak',
  'journal_flagged',
  'prayer_unconfirmed',
  'serving_declined',
  'registration_review',
  'general',
] as const;
export const CARE_STATUSES = ['open', 'in_progress', 'resolved', 'dismissed'] as const;
export const CARE_VISIBILITIES = ['leadership', 'pastoral'] as const;
export const ENTRY_CODE_KINDS = ['journal_general', 'journal_leader', 'prayer_chain'] as const;
export const ENTRY_CODE_STATUSES = ['active', 'retired'] as const;
export const PARTICIPANT_KEY_ORIGINS = ['registration', 'phone_match', 'personal_link', 'otp'] as const;
export const ACTION_TOKEN_PURPOSES = ['personal_key_install', 'prayer_assignment', 'gathering_assignment'] as const;

// ─── M3: prayer chain, notifications, background jobs ─────────────────────────
export const PRAYER_CHAIN_TYPES = ['continuous', 'scheduled_blocks', 'event'] as const;
export const PRAYER_CHAIN_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export const PRAYER_SLOT_STATUSES = ['open', 'cancelled'] as const;
export const PRAYER_ASSIGNMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'in_prayer',
  'completed',
  'needs_follow_up',
  'missed',
  'excused',
  'replaced',
  'cancelled',
] as const;
/** Assignments that still hold the person's time (and count for overlap and capacity). */
export const PRAYER_ACTIVE_STATUSES = ['scheduled', 'confirmed', 'in_prayer', 'completed', 'needs_follow_up', 'missed'] as const;
export const PRAYER_ASSIGNMENT_SOURCES = ['commitment', 'manual', 'substitute', 'self_signup'] as const;
export const PRAYER_EVENT_TYPES = [
  'assigned',
  'confirmed',
  'checked_in',
  'completed',
  'cannot_make_it',
  'substitute_assigned',
  'flagged_follow_up',
  'resolved_missed',
  'resolved_excused',
  'resolved_completed',
  'cancelled',
  'reopened',
  'report_submitted',
] as const;
export const PRAYER_EVENT_VIA = ['action_link', 'chain_page', 'portal', 'job'] as const;
export const NOTIFICATION_STATUSES = ['pending', 'processing', 'sent', 'partially_sent', 'failed', 'suppressed', 'cancelled'] as const;
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export const DELIVERY_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'bounced'] as const;
export const JOB_RUN_STATUSES = ['running', 'ok', 'error'] as const;

// ─── M4: devotional / worship, shared scheduling ──────────────────────────────
export const SERVING_ROLE_CATEGORIES = ['music', 'word', 'prayer', 'production', 'hosting', 'other'] as const;
export const ROTATION_MODES = ['none', 'per_occurrence', 'weekly'] as const;
export const GATHERING_STATUSES = ['scheduled', 'cancelled', 'completed'] as const;
export const GATHERING_ASSIGNMENT_STATUSES = ['pending', 'confirmed', 'declined', 'replaced', 'cancelled'] as const;
/** Assignments that hold a place on the roster (BR-D-01). */
export const GATHERING_ACTIVE_STATUSES = ['pending', 'confirmed'] as const;
export const GATHERING_ASSIGNMENT_SOURCES = ['rotation', 'manual', 'substitute'] as const;
export const UNAVAILABILITY_SOURCES = ['self', 'coordinator', 'admin'] as const;

export type ServingRoleCategory = (typeof SERVING_ROLE_CATEGORIES)[number];
export type RotationMode = (typeof ROTATION_MODES)[number];
export type GatheringStatus = (typeof GATHERING_STATUSES)[number];
export type GatheringAssignmentStatus = (typeof GATHERING_ASSIGNMENT_STATUSES)[number];
export type GatheringAssignmentSource = (typeof GATHERING_ASSIGNMENT_SOURCES)[number];

export type PrayerChainType = (typeof PRAYER_CHAIN_TYPES)[number];
export type PrayerChainStatus = (typeof PRAYER_CHAIN_STATUSES)[number];
export type PrayerAssignmentStatus = (typeof PRAYER_ASSIGNMENT_STATUSES)[number];
export type PrayerEventType = (typeof PRAYER_EVENT_TYPES)[number];

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export type Sensitivity = (typeof SENSITIVITIES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type JournalChannel = (typeof JOURNAL_CHANNELS)[number];

export type Gender = (typeof GENDERS)[number];
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type PersonSource = (typeof PERSON_SOURCES)[number];
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];
export type LeadershipChangeType = (typeof LEADERSHIP_CHANGE_TYPES)[number];
export type ScopeType = (typeof SCOPE_TYPES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
