import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import {
  ACTOR_TYPES,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_STATUSES,
  PRAYER_ASSIGNMENT_SOURCES,
  PRAYER_ASSIGNMENT_STATUSES,
  PRAYER_CHAIN_STATUSES,
  PRAYER_CHAIN_TYPES,
  PRAYER_EVENT_TYPES,
  PRAYER_EVENT_VIA,
  PRAYER_REPORT_PHOTO_RULES,
  PRAYER_SLOT_STATUSES,
} from '../enums';
import { formResponses, forms } from './forms';
import { users } from './iam';
import { ministries } from './ministries';
import { people } from './people';

/**
 * Prayer chain (docs/03 §4.11). Overlap rules that Drizzle can't express — slots in one chain
 * never overlap, and one person never holds overlapping assignments — are GiST exclusion
 * constraints added in migration 0006.
 */

export const prayerChains = pgTable(
  'prayer_chains',
  {
    id: pk(),
    name: text('name').notNull(),
    description: text('description'),
    chainType: text('chain_type', { enum: PRAYER_CHAIN_TYPES }).notNull(),
    /** IANA time zone; validated in the application. */
    timezone: text('timezone').notNull().default('Asia/Manila'),
    ministryId: uuid('ministry_id').references((): AnyPgColumn => ministries.id),
    status: text('status', { enum: PRAYER_CHAIN_STATUSES }).notNull().default('draft'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    graceMinutes: smallint('grace_minutes').notNull().default(15),
    checkinOpensMinutes: smallint('checkin_opens_minutes').notNull().default(15),
    requireCheckin: boolean('require_checkin').notNull().default(false),
    /** The public chain page may show first names of who is praying now. */
    showNamesPublicly: boolean('show_names_publicly').notNull().default(false),
    /** People may take an open hour themselves from the chain page (docs/05 W11 self sign-up). */
    allowSelfSignup: boolean('allow_self_signup').notNull().default(false),
    /** Whether a prayer report carries a photo of the prayer time: required, optional or off. */
    reportPhoto: text('report_photo', { enum: PRAYER_REPORT_PHOTO_RULES }).notNull().default('optional'),
    /** NULL = no report form after completing a slot. */
    reportFormId: uuid('report_form_id').references((): AnyPgColumn => forms.id),
    archivedAt: tstz('archived_at'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('prayer_chains_type_check', oneOf('chain_type', PRAYER_CHAIN_TYPES)),
    check('prayer_chains_status_check', oneOf('status', PRAYER_CHAIN_STATUSES)),
    check('prayer_chains_dates', sql`ends_on IS NULL OR ends_on >= starts_on`),
    check('prayer_chains_grace_range', sql`grace_minutes BETWEEN 0 AND 240`),
    check('prayer_chains_checkin_range', sql`checkin_opens_minutes BETWEEN 0 AND 120`),
    check('prayer_chains_name_length', sql`length(btrim(name)) BETWEEN 1 AND 120`),
    check('prayer_chains_report_photo_check', oneOf('report_photo', PRAYER_REPORT_PHOTO_RULES)),
  ],
);

export const prayerChainSchedules = pgTable(
  'prayer_chain_schedules',
  {
    id: pk(),
    prayerChainId: uuid('prayer_chain_id')
      .notNull()
      .references((): AnyPgColumn => prayerChains.id),
    /** Supported RFC 5545 subset: FREQ=DAILY or FREQ=WEEKLY;BYDAY=…, optional INTERVAL (src/server/modules/prayer/recurrence.ts). */
    rrule: text('rrule').notNull(),
    /** Local wall-clock time of the first slot of each occurrence. */
    firstSlotTime: time('first_slot_time').notNull(),
    slotMinutes: smallint('slot_minutes').notNull(),
    slotsPerOccurrence: smallint('slots_per_occurrence').notNull(),
    capacity: smallint('capacity').notNull().default(1),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    generateDaysAhead: smallint('generate_days_ahead').notNull().default(14),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('prayer_schedules_slot_minutes', sql`slot_minutes BETWEEN 5 AND 1440`),
    check('prayer_schedules_slots_per_occurrence', sql`slots_per_occurrence BETWEEN 1 AND 288`),
    // One occurrence never exceeds 24 hours, so a daily schedule can't overlap itself.
    check('prayer_schedules_occurrence_length', sql`slot_minutes * slots_per_occurrence <= 1440`),
    check('prayer_schedules_capacity', sql`capacity BETWEEN 1 AND 50`),
    check('prayer_schedules_days_ahead', sql`generate_days_ahead BETWEEN 1 AND 90`),
    check('prayer_schedules_dates', sql`effective_to IS NULL OR effective_to >= effective_from`),
    index('prayer_schedules_chain').on(t.prayerChainId),
  ],
);

/** "Mary prays every Tuesday at 2:00 AM": matching generated slots are assigned automatically. */
export const prayerCommitments = pgTable(
  'prayer_commitments',
  {
    id: pk(),
    prayerChainId: uuid('prayer_chain_id')
      .notNull()
      .references((): AnyPgColumn => prayerChains.id),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    rrule: text('rrule').notNull(),
    localStartTime: time('local_start_time').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    endedAt: tstz('ended_at'),
  },
  (t) => [
    check('prayer_commitments_dates', sql`effective_to IS NULL OR effective_to >= effective_from`),
    index('prayer_commitments_active').on(t.prayerChainId).where(sql`ended_at IS NULL`),
    index('prayer_commitments_person').on(t.personId),
  ],
);

export const prayerSlots = pgTable(
  'prayer_slots',
  {
    id: pk(),
    prayerChainId: uuid('prayer_chain_id')
      .notNull()
      .references((): AnyPgColumn => prayerChains.id),
    /** NULL for one-off slots. */
    scheduleId: uuid('schedule_id').references((): AnyPgColumn => prayerChainSchedules.id),
    /** Chain-local date of starts_at (BR-PR-06). */
    chainDate: date('chain_date').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    capacity: smallint('capacity').notNull().default(1),
    status: text('status', { enum: PRAYER_SLOT_STATUSES }).notNull().default('open'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('prayer_slots_status_check', oneOf('status', PRAYER_SLOT_STATUSES)),
    check('prayer_slots_times', sql`ends_at > starts_at`),
    check('prayer_slots_capacity', sql`capacity BETWEEN 1 AND 50`),
    // Idempotent generation.
    unique('prayer_slots_chain_start').on(t.prayerChainId, t.startsAt),
    index('prayer_slots_board').on(t.prayerChainId, t.chainDate, t.startsAt),
    index('prayer_slots_ending').on(t.endsAt).where(sql`status = 'open'`),
  ],
);

export const prayerAssignments = pgTable(
  'prayer_assignments',
  {
    id: pk(),
    slotId: uuid('slot_id')
      .notNull()
      .references((): AnyPgColumn => prayerSlots.id),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    /** Copies of the slot's times (docs/03 `slot_period`): the person-overlap constraint needs them on this row. */
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    status: text('status', { enum: PRAYER_ASSIGNMENT_STATUSES }).notNull().default('scheduled'),
    completedLate: boolean('completed_late').notNull().default(false),
    verifiedByCoordinator: boolean('verified_by_coordinator').notNull().default(false),
    source: text('source', { enum: PRAYER_ASSIGNMENT_SOURCES }).notNull(),
    commitmentId: uuid('commitment_id').references((): AnyPgColumn => prayerCommitments.id),
    substituteForId: uuid('substitute_for_id').references((): AnyPgColumn => prayerAssignments.id),
    confirmedAt: tstz('confirmed_at'),
    checkedInAt: tstz('checked_in_at'),
    completedAt: tstz('completed_at'),
    /** The person said they can't make it; the coordinator arranges a substitute. */
    cannotMakeItAt: tstz('cannot_make_it_at'),
    /** Coordinator decisions (missed / excused / verified). */
    resolvedBy: uuid('resolved_by').references((): AnyPgColumn => users.id),
    resolvedAt: tstz('resolved_at'),
    reportResponseId: uuid('report_response_id')
      .unique()
      .references((): AnyPgColumn => formResponses.id),
    note: text('note'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('prayer_assignments_status_check', oneOf('status', PRAYER_ASSIGNMENT_STATUSES)),
    check('prayer_assignments_source_check', oneOf('source', PRAYER_ASSIGNMENT_SOURCES)),
    check('prayer_assignments_times', sql`ends_at > starts_at`),
    check('prayer_assignments_not_self_substitute', sql`substitute_for_id IS NULL OR substitute_for_id <> id`),
    // Only humans decide Missed and Excused (BR-PR-04).
    check('prayer_assignments_human_resolution', sql`status NOT IN ('missed', 'excused') OR resolved_by IS NOT NULL`),
    check('prayer_assignments_commitment_source', sql`(source = 'commitment') = (commitment_id IS NOT NULL)`),
    check('prayer_assignments_substitute_source', sql`(source = 'substitute') = (substitute_for_id IS NOT NULL)`),
    uniqueIndex('prayer_assignment_active').on(t.slotId, t.personId).where(sql`status NOT IN ('replaced', 'cancelled')`),
    index('prayer_assignments_slot').on(t.slotId),
    index('prayer_assignments_person').on(t.personId, t.startsAt),
    index('prayer_assignments_open').on(t.endsAt).where(sql`status IN ('scheduled', 'confirmed', 'in_prayer')`),
    index('prayer_assignments_followup').on(t.updatedAt).where(sql`status = 'needs_follow_up'`),
  ],
);

/** Append-only timeline of each assignment. */
export const prayerAssignmentEvents = pgTable(
  'prayer_assignment_events',
  {
    id: pk(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references((): AnyPgColumn => prayerAssignments.id),
    eventType: text('event_type', { enum: PRAYER_EVENT_TYPES }).notNull(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorUserId: uuid('actor_user_id').references((): AnyPgColumn => users.id),
    via: text('via', { enum: PRAYER_EVENT_VIA }),
    note: text('note'),
  },
  (t) => [
    check('prayer_events_type_check', oneOf('event_type', PRAYER_EVENT_TYPES)),
    check('prayer_events_actor_check', oneOf('actor_type', ACTOR_TYPES)),
    check('prayer_events_via_check', sql`via IS NULL OR ${oneOf('via', PRAYER_EVENT_VIA)}`),
    index('prayer_events_by_assignment').on(t.assignmentId, t.occurredAt),
  ],
);

/**
 * A photo shared with a prayer report (docs/02 §4 "Prayer report photos"). The same shape and the
 * same pipeline as a journal's proof photo — decoded to prove what it is, re-encoded so no EXIF
 * survives, kept in a private bucket under a path that names nobody — but with its own foreign key
 * to the report it belongs to, which a shared table could not have.
 */
export const prayerReportAttachments = pgTable(
  'prayer_report_attachments',
  {
    id: pk(),
    /** The hour it was taken for. Known from the moment it is uploaded, before any report exists. */
    assignmentId: uuid('assignment_id')
      .notNull()
      .references((): AnyPgColumn => prayerAssignments.id),
    /** NULL until the report it belongs to is submitted. */
    responseId: uuid('response_id').references((): AnyPgColumn => formResponses.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    status: text('status', { enum: ATTACHMENT_STATUSES }).notNull().default('pending'),
    storageBucket: text('storage_bucket').notNull(),
    /** Server-generated, never a name the browser chose (docs/02 §8 "Uploads"). */
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type', { enum: ATTACHMENT_MIME_TYPES }).notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** SHA-256 of the stored bytes: proves the file was not swapped underneath the row. */
    checksum: text('checksum').notNull(),
    createdAt: createdAt(),
    attachedAt: tstz('attached_at'),
    removedAt: tstz('removed_at'),
    removedBy: uuid('removed_by').references((): AnyPgColumn => users.id),
    /** When the file itself was deleted. The row stays, so the record still shows it existed. */
    deletedFileAt: tstz('deleted_file_at'),
  },
  (t) => [
    check('prayer_report_attachments_status_check', oneOf('status', ATTACHMENT_STATUSES)),
    check('prayer_report_attachments_mime_check', oneOf('mime_type', ATTACHMENT_MIME_TYPES)),
    check('prayer_report_attachments_size', sql`file_size_bytes > 0`),
    // A photo waiting for its report has none; an attached one knows which report and when. A
    // removed one keeps both, so the record still shows which report it was taken off.
    check('prayer_report_attachments_pending_unattached', sql`status <> 'pending' OR (response_id IS NULL AND attached_at IS NULL)`),
    check('prayer_report_attachments_attached_complete', sql`status <> 'attached' OR (response_id IS NOT NULL AND attached_at IS NOT NULL)`),
    unique('prayer_report_attachments_path').on(t.storageBucket, t.storagePath),
    // One live photo per report, without stopping a replaced one from staying on the record.
    uniqueIndex('prayer_report_attachments_one_photo').on(t.responseId).where(sql`status = 'attached'`),
    // The cleanup job's query: pending uploads, oldest first.
    index('prayer_report_attachments_pending').on(t.createdAt).where(sql`status = 'pending'`),
  ],
);
