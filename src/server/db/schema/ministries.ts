import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import { MINISTRY_POSITIONS, TEAM_MEMBER_ROLES, TEAM_TYPES } from '../enums';
import { people } from './people';

/**
 * Ministry (service) structure — deliberately independent from the leadership hierarchy
 * (docs/01 BR-H-07). docs/03-database.md §4.4
 * `team_member_serving_roles` lives in ./devotional.ts, next to the serving roles it references.
 */
export const ministries = pgTable(
  'ministries',
  {
    id: pk(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    description: text('description'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [uniqueIndex('ministries_name_active').on(sql`lower(name)`).where(sql`archived_at IS NULL`)],
);

export const departments = pgTable(
  'departments',
  {
    id: pk(),
    ministryId: uuid('ministry_id')
      .notNull()
      .references((): AnyPgColumn => ministries.id),
    name: text('name').notNull(),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('departments_id_ministry_unique').on(t.id, t.ministryId),
    uniqueIndex('departments_name_active')
      .on(t.ministryId, sql`lower(name)`)
      .where(sql`archived_at IS NULL`),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: pk(),
    ministryId: uuid('ministry_id')
      .notNull()
      .references((): AnyPgColumn => ministries.id),
    departmentId: uuid('department_id'),
    name: text('name').notNull(),
    teamType: text('team_type', { enum: TEAM_TYPES }).notNull().default('general'),
    leadPersonId: uuid('lead_person_id').references((): AnyPgColumn => people.id),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('teams_team_type_check', oneOf('team_type', TEAM_TYPES)),
    // The department (when given) must belong to the same ministry.
    foreignKey({
      name: 'teams_department_same_ministry_fk',
      columns: [t.departmentId, t.ministryId],
      foreignColumns: [departments.id, departments.ministryId],
    }),
    uniqueIndex('teams_name_active')
      .on(t.ministryId, sql`lower(name)`)
      .where(sql`archived_at IS NULL`),
  ],
);

export const ministryMemberships = pgTable(
  'ministry_memberships',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    ministryId: uuid('ministry_id')
      .notNull()
      .references((): AnyPgColumn => ministries.id),
    departmentId: uuid('department_id'),
    position: text('position', { enum: MINISTRY_POSITIONS }).notNull().default('member'),
    isPrimary: boolean('is_primary').notNull().default(false),
    startedOn: date('started_on')
      .notNull()
      .default(sql`current_date`),
    endedOn: date('ended_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('ministry_memberships_position_check', oneOf('position', MINISTRY_POSITIONS)),
    check('ministry_memberships_dates', sql`ended_on IS NULL OR ended_on >= started_on`),
    foreignKey({
      name: 'ministry_memberships_department_same_ministry_fk',
      columns: [t.departmentId, t.ministryId],
      foreignColumns: [departments.id, departments.ministryId],
    }),
    uniqueIndex('ministry_membership_active').on(t.personId, t.ministryId).where(sql`ended_on IS NULL`),
    uniqueIndex('ministry_membership_primary').on(t.personId).where(sql`is_primary AND ended_on IS NULL`),
    index('ministry_membership_by_ministry').on(t.ministryId, t.departmentId).where(sql`ended_on IS NULL`),
  ],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: pk(),
    teamId: uuid('team_id')
      .notNull()
      .references((): AnyPgColumn => teams.id),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    memberRole: text('member_role', { enum: TEAM_MEMBER_ROLES }).notNull().default('member'),
    joinedOn: date('joined_on')
      .notNull()
      .default(sql`current_date`),
    leftOn: date('left_on'),
    createdAt: createdAt(),
  },
  (t) => [
    check('team_memberships_role_check', oneOf('member_role', TEAM_MEMBER_ROLES)),
    check('team_memberships_dates', sql`left_on IS NULL OR left_on >= joined_on`),
    uniqueIndex('team_membership_active').on(t.teamId, t.personId).where(sql`left_on IS NULL`),
    index('team_membership_person').on(t.personId).where(sql`left_on IS NULL`),
  ],
);
