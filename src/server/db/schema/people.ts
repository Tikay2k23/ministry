import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import {
  ARCHIVE_REASONS,
  DUPLICATE_STATUSES,
  GENDERS,
  PERSON_SOURCES,
  PERSON_STATUSES,
  REGISTRATION_STATUSES,
} from '../enums';
import { users } from './iam';
import { privacyNoticeVersions } from './settings';

/** docs/03-database.md §4.2 */
export const people = pgTable(
  'people',
  {
    id: pk(),
    personCode: text('person_code').notNull().unique(),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name'),
    lastName: text('last_name').notNull(),
    suffix: text('suffix'),
    preferredName: text('preferred_name'),
    gender: text('gender', { enum: GENDERS }),
    birthMonth: smallint('birth_month'),
    birthDay: smallint('birth_day'),
    birthYear: smallint('birth_year'),
    /** E.164, NOT unique — families share phones (BR-P-01). */
    phoneE164: text('phone_e164'),
    phoneVerifiedAt: tstz('phone_verified_at'),
    email: citext('email'),
    addressLine: text('address_line'),
    city: text('city'),
    province: text('province'),
    countryCode: char('country_code', { length: 2 }),
    status: text('status', { enum: PERSON_STATUSES }).notNull().default('active'),
    registrationStatus: text('registration_status', { enum: REGISTRATION_STATUSES })
      .notNull()
      .default('confirmed'),
    source: text('source', { enum: PERSON_SOURCES }).notNull(),
    joinedOn: date('joined_on'),
    journalExpected: boolean('journal_expected').notNull().default(true),
    consentVersion: text('consent_version').references((): AnyPgColumn => privacyNoticeVersions.version),
    consentAt: tstz('consent_at'),
    guardianName: text('guardian_name'),
    guardianRelationship: text('guardian_relationship'),
    guardianConsentAt: tstz('guardian_consent_at'),
    mergedIntoPersonId: uuid('merged_into_person_id').references((): AnyPgColumn => people.id),
    archivedAt: tstz('archived_at'),
    archivedReason: text('archived_reason', { enum: ARCHIVE_REASONS }),
    /** Accent-insensitive, lower-cased search text (trigram-indexed). */
    searchName: text('search_name').generatedAlwaysAs(
      sql`lower(immutable_unaccent(first_name || ' ' || coalesce(preferred_name, '') || ' ' || coalesce(middle_name, '') || ' ' || last_name))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    updatedBy: uuid('updated_by').references((): AnyPgColumn => users.id),
  },
  (t) => [
    check('people_person_code_format', sql`person_code ~ '^P-[0-9A-HJKMNP-TV-Z]{6}$'`),
    check('people_first_name_length', sql`length(btrim(first_name)) BETWEEN 1 AND 80`),
    check('people_last_name_length', sql`length(btrim(last_name)) BETWEEN 1 AND 80`),
    check('people_gender_check', sql`gender IS NULL OR ${oneOf('gender', GENDERS)}`),
    check('people_birth_month_check', sql`birth_month IS NULL OR birth_month BETWEEN 1 AND 12`),
    check('people_birth_day_check', sql`birth_day IS NULL OR birth_day BETWEEN 1 AND 31`),
    check('people_birth_year_check', sql`birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100`),
    check('people_phone_format', sql`phone_e164 IS NULL OR phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('people_status_check', oneOf('status', PERSON_STATUSES)),
    check('people_registration_status_check', oneOf('registration_status', REGISTRATION_STATUSES)),
    check('people_source_check', oneOf('source', PERSON_SOURCES)),
    check(
      'people_archived_reason_check',
      sql`archived_reason IS NULL OR ${oneOf('archived_reason', ARCHIVE_REASONS)}`,
    ),
    check('people_archive_consistency', sql`(archived_at IS NULL) = (archived_reason IS NULL)`),
    check(
      'people_merge_consistency',
      sql`merged_into_person_id IS NULL OR (archived_reason = 'duplicate' AND merged_into_person_id <> id)`,
    ),
    index('people_search_trgm').using('gin', t.searchName.op('gin_trgm_ops')),
    index('people_phone').on(t.phoneE164).where(sql`archived_at IS NULL`),
    index('people_email').on(t.email).where(sql`archived_at IS NULL`),
    index('people_sort_name').on(t.lastName, t.firstName, t.id).where(sql`archived_at IS NULL`),
    index('people_unconfirmed')
      .on(t.createdAt)
      .where(sql`registration_status = 'unconfirmed' AND archived_at IS NULL`),
  ],
);

/** Configurable vocabulary: member, worker, pastor, staff… (FR-PPL-03). */
export const designationTypes = pgTable('designation_types', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const personDesignations = pgTable(
  'person_designations',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    designationKey: text('designation_key')
      .notNull()
      .references((): AnyPgColumn => designationTypes.key, { onUpdate: 'cascade' }),
    startedOn: date('started_on')
      .notNull()
      .default(sql`current_date`),
    endedOn: date('ended_on'),
    createdAt: createdAt(),
  },
  (t) => [
    check('person_designations_dates', sql`ended_on IS NULL OR ended_on >= started_on`),
    uniqueIndex('person_designation_active')
      .on(t.personId, t.designationKey)
      .where(sql`ended_on IS NULL`),
  ],
);

/** Raised on create/import/registration; never auto-merged (BR-P-03). */
export const personDuplicateCandidates = pgTable(
  'person_duplicate_candidates',
  {
    id: pk(),
    personAId: uuid('person_a_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    personBId: uuid('person_b_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    reasons: text('reasons').array().notNull(),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    status: text('status', { enum: DUPLICATE_STATUSES }).notNull().default('open'),
    reviewedBy: uuid('reviewed_by').references((): AnyPgColumn => users.id),
    reviewedAt: tstz('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('duplicate_pair_order', sql`person_a_id < person_b_id`),
    check('duplicate_score_range', sql`score BETWEEN 0 AND 1`),
    check('duplicate_status_check', oneOf('status', DUPLICATE_STATUSES)),
    unique('duplicate_pair_unique').on(t.personAId, t.personBId),
    index('duplicate_open').on(t.createdAt).where(sql`status = 'open'`),
  ],
);
