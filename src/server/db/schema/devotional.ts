import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import {
  GATHERING_ASSIGNMENT_SOURCES,
  GATHERING_ASSIGNMENT_STATUSES,
  GATHERING_STATUSES,
  ROTATION_MODES,
  SERVING_ROLE_CATEGORIES,
} from '../enums';
import { users } from './iam';
import { ministries, teamMemberships, teams } from './ministries';
import { people } from './people';

/**
 * Morning devotional / worship (docs/03 §4.12). Gatherings are generated once per schedule and
 * date, so regenerating never overwrites a coordinator's edits (BR-D-03), and their rosters are
 * filled from the rotating team's default serving roles. Times use the ministry's time zone.
 */

/** The configurable vocabulary: Worship Leader, Keyboard, Prayer Leader, … (FR-DEV-02). */
export const servingRoles = pgTable(
  'serving_roles',
  {
    id: pk(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    category: text('category', { enum: SERVING_ROLE_CATEGORIES }).notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('serving_roles_category_check', oneOf('category', SERVING_ROLE_CATEGORIES)),
    check('serving_roles_key_format', sql`key ~ '^[a-z][a-z0-9_]{1,59}$'`),
    check('serving_roles_name_length', sql`length(btrim(name)) BETWEEN 1 AND 60`),
  ],
);

export const gatheringTypes = pgTable(
  'gathering_types',
  {
    id: pk(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    defaultStartTime: time('default_start_time').notNull(),
    defaultDurationMinutes: smallint('default_duration_minutes').notNull(),
    /** The owning ministry: its heads and ministry-scoped coordinators manage this type. */
    ministryId: uuid('ministry_id').references((): AnyPgColumn => ministries.id),
    /** Within this many hours of the start, a response can no longer be changed from the link. */
    responseLockHours: smallint('response_lock_hours').notNull().default(12),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('gathering_types_key_format', sql`key ~ '^[a-z][a-z0-9_]{1,59}$'`),
    check('gathering_types_name_length', sql`length(btrim(name)) BETWEEN 1 AND 80`),
    check('gathering_types_duration', sql`default_duration_minutes BETWEEN 5 AND 600`),
    check('gathering_types_lock_hours', sql`response_lock_hours BETWEEN 0 AND 168`),
  ],
);

/** The roster template: which roles a gathering needs, and how many (FR-DEV-01). */
export const gatheringTypeRoles = pgTable(
  'gathering_type_roles',
  {
    gatheringTypeId: uuid('gathering_type_id')
      .notNull()
      .references((): AnyPgColumn => gatheringTypes.id, { onDelete: 'cascade' }),
    servingRoleId: uuid('serving_role_id')
      .notNull()
      .references((): AnyPgColumn => servingRoles.id),
    /** Required people for this role; 0 = optional. */
    minCount: smallint('min_count').notNull().default(1),
    maxCount: smallint('max_count').notNull().default(1),
    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'gathering_type_roles_pk', columns: [t.gatheringTypeId, t.servingRoleId] }),
    check('gathering_type_roles_min', sql`min_count BETWEEN 0 AND 20`),
    check('gathering_type_roles_max', sql`max_count >= greatest(min_count, 1) AND max_count <= 20`),
  ],
);

export const gatheringSchedules = pgTable(
  'gathering_schedules',
  {
    id: pk(),
    gatheringTypeId: uuid('gathering_type_id')
      .notNull()
      .references((): AnyPgColumn => gatheringTypes.id),
    name: text('name').notNull(),
    /** RFC 5545 subset: daily, weekly by day, or monthly (src/server/modules/scheduling/recurrence.ts). */
    rrule: text('rrule').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    rotationMode: text('rotation_mode', { enum: ROTATION_MODES }).notNull().default('none'),
    /** The occurrence (per_occurrence) or the week (weekly) that maps to rotation position 0. */
    rotationAnchor: date('rotation_anchor'),
    generateDaysAhead: smallint('generate_days_ahead').notNull().default(56),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('gathering_schedules_rotation_mode_check', oneOf('rotation_mode', ROTATION_MODES)),
    check('gathering_schedules_rotation_anchor', sql`rotation_mode = 'none' OR rotation_anchor IS NOT NULL`),
    check('gathering_schedules_name_length', sql`length(btrim(name)) BETWEEN 1 AND 80`),
    check('gathering_schedules_duration', sql`duration_minutes BETWEEN 5 AND 600`),
    check('gathering_schedules_days_ahead', sql`generate_days_ahead BETWEEN 1 AND 180`),
    check('gathering_schedules_dates', sql`effective_to IS NULL OR effective_to >= effective_from`),
    index('gathering_schedules_type').on(t.gatheringTypeId),
  ],
);

/** Rotation order A → B → C (position 0, 1, 2…). */
export const gatheringScheduleTeams = pgTable(
  'gathering_schedule_teams',
  {
    scheduleId: uuid('schedule_id')
      .notNull()
      .references((): AnyPgColumn => gatheringSchedules.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references((): AnyPgColumn => teams.id),
  },
  (t) => [
    primaryKey({ name: 'gathering_schedule_teams_pk', columns: [t.scheduleId, t.position] }),
    check('gathering_schedule_teams_position', sql`position BETWEEN 0 AND 51`),
    index('gathering_schedule_teams_team').on(t.teamId),
  ],
);

/** One concrete occurrence. */
export const gatherings = pgTable(
  'gatherings',
  {
    id: pk(),
    gatheringTypeId: uuid('gathering_type_id')
      .notNull()
      .references((): AnyPgColumn => gatheringTypes.id),
    /** NULL for a one-off gathering. */
    scheduleId: uuid('schedule_id').references((): AnyPgColumn => gatheringSchedules.id),
    /** The ministry-local date of the start. */
    occursOn: date('occurs_on').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id),
    title: text('title'),
    status: text('status', { enum: GATHERING_STATUSES }).notNull().default('scheduled'),
    /** NULL = draft roster: nobody has been told yet. */
    rosterPublishedAt: tstz('roster_published_at'),
    cancelReason: text('cancel_reason'),
    notes: text('notes'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('gatherings_status_check', oneOf('status', GATHERING_STATUSES)),
    check('gatherings_times', sql`ends_at > starts_at`),
    check('gatherings_cancel_reason', sql`(status = 'cancelled') = (cancel_reason IS NOT NULL)`),
    check('gatherings_title_length', sql`title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120`),
    // BR-D-03: generation is idempotent per (schedule, date).
    uniqueIndex('gatherings_generated').on(t.scheduleId, t.occursOn).where(sql`schedule_id IS NOT NULL`),
    index('gatherings_by_date').on(t.occursOn, t.gatheringTypeId),
    index('gatherings_by_start').on(t.startsAt),
  ],
);

export const gatheringAssignments = pgTable(
  'gathering_assignments',
  {
    id: pk(),
    gatheringId: uuid('gathering_id')
      .notNull()
      .references((): AnyPgColumn => gatherings.id),
    servingRoleId: uuid('serving_role_id')
      .notNull()
      .references((): AnyPgColumn => servingRoles.id),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    status: text('status', { enum: GATHERING_ASSIGNMENT_STATUSES }).notNull().default('pending'),
    source: text('source', { enum: GATHERING_ASSIGNMENT_SOURCES }).notNull(),
    substituteForId: uuid('substitute_for_id').references((): AnyPgColumn => gatheringAssignments.id),
    respondedAt: tstz('responded_at'),
    responseNote: text('response_note'),
    /** When the person was told (the roster was published, or they were added afterwards). */
    notifiedAt: tstz('notified_at'),
    assignedBy: uuid('assigned_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('gathering_assignments_status_check', oneOf('status', GATHERING_ASSIGNMENT_STATUSES)),
    check('gathering_assignments_source_check', oneOf('source', GATHERING_ASSIGNMENT_SOURCES)),
    check('gathering_assignments_not_self_substitute', sql`substitute_for_id IS NULL OR substitute_for_id <> id`),
    check('gathering_assignments_substitute_source', sql`(source = 'substitute') = (substitute_for_id IS NOT NULL)`),
    check('gathering_assignments_note_length', sql`response_note IS NULL OR length(response_note) <= 500`),
    // BR-D-01: one active assignment per (gathering, role, person).
    uniqueIndex('gathering_assignment_active')
      .on(t.gatheringId, t.servingRoleId, t.personId)
      .where(sql`status IN ('pending', 'confirmed')`),
    index('gathering_assignments_gathering').on(t.gatheringId),
    index('gathering_assignments_person').on(t.personId, t.createdAt.desc()),
    index('gathering_assignments_pending').on(t.gatheringId).where(sql`status = 'pending'`),
  ],
);

/** The roles a team member usually plays, e.g. keyboard and backup vocal (docs/03 §4.4). */
export const teamMemberServingRoles = pgTable(
  'team_member_serving_roles',
  {
    teamMembershipId: uuid('team_membership_id')
      .notNull()
      .references((): AnyPgColumn => teamMemberships.id, { onDelete: 'cascade' }),
    servingRoleId: uuid('serving_role_id')
      .notNull()
      .references((): AnyPgColumn => servingRoles.id),
    /** Preferred first when the roster is filled. */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'team_member_serving_roles_pk', columns: [t.teamMembershipId, t.servingRoleId] }),
    uniqueIndex('team_member_primary_role').on(t.teamMembershipId).where(sql`is_primary`),
    index('team_member_serving_roles_role').on(t.servingRoleId),
  ],
);
