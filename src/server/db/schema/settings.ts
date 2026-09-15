import { sql } from 'drizzle-orm';
import { boolean, check, date, jsonb, pgTable, smallint, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import { CALENDAR_DAY_KINDS } from '../enums';
import { users } from './iam';

/** Key/value settings validated by a Zod schema per key (src/server/modules/settings). */
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references((): AnyPgColumn => users.id),
  updatedAt: updatedAt(),
});

/** Display names for each depth of the leadership tree (docs/01 FR-LDR-02). */
export const leadershipLevels = pgTable(
  'leadership_levels',
  {
    id: pk(),
    depth: smallint('depth').notNull().unique(),
    name: text('name').notNull(),
    pluralName: text('plural_name').notNull(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('leadership_levels_depth_check', sql`depth >= 0`)],
);

/** Rest days, holidays and special days (docs/01 FR-JRN-18). */
export const ministryCalendarDays = pgTable(
  'ministry_calendar_days',
  {
    day: date('day').primaryKey(),
    kind: text('kind', { enum: CALENDAR_DAY_KINDS }).notNull(),
    excusesJournal: boolean('excuses_journal').notNull().default(true),
    note: text('note'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  () => [check('ministry_calendar_days_kind_check', oneOf('kind', CALENDAR_DAY_KINDS))],
);

export const privacyNoticeVersions = pgTable('privacy_notice_versions', {
  version: text('version').primaryKey(),
  bodyMarkdown: text('body_markdown').notNull(),
  publishedAt: tstz('published_at').notNull(),
  publishedBy: uuid('published_by').references((): AnyPgColumn => users.id),
});
