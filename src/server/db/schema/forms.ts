import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import { FORM_FIELD_TYPES, FORM_PURPOSES, FORM_VERSION_STATUSES, SENSITIVITIES } from '../enums';
import { users } from './iam';
import { people } from './people';

/**
 * Versioned forms engine (docs/03 §4.6): journal questions now, prayer reports and other
 * forms later. Published versions are immutable; changes create a new version.
 */
export const forms = pgTable(
  'forms',
  {
    id: pk(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    purpose: text('purpose', { enum: FORM_PURPOSES }).notNull(),
    description: text('description'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('forms_purpose_check', oneOf('purpose', FORM_PURPOSES)),
    check('forms_key_format', sql`key ~ '^[a-z][a-z0-9_]{1,62}$'`),
  ],
);

export const formVersions = pgTable(
  'form_versions',
  {
    id: pk(),
    formId: uuid('form_id')
      .notNull()
      .references((): AnyPgColumn => forms.id),
    versionNo: integer('version_no').notNull(),
    status: text('status', { enum: FORM_VERSION_STATUSES }).notNull().default('draft'),
    publishedAt: tstz('published_at'),
    publishedBy: uuid('published_by').references((): AnyPgColumn => users.id),
    retiredAt: tstz('retired_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('form_versions_form_version').on(t.formId, t.versionNo),
    check('form_versions_status_check', oneOf('status', FORM_VERSION_STATUSES)),
    check('form_versions_version_positive', sql`version_no > 0`),
    check('form_versions_published_consistency', sql`(status = 'draft') = (published_at IS NULL)`),
    check('form_versions_retired_consistency', sql`(status = 'retired') = (retired_at IS NOT NULL)`),
    uniqueIndex('form_one_published').on(t.formId).where(sql`status = 'published'`),
    uniqueIndex('form_one_draft').on(t.formId).where(sql`status = 'draft'`),
  ],
);

export const formFields = pgTable(
  'form_fields',
  {
    id: pk(),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references((): AnyPgColumn => formVersions.id, { onDelete: 'cascade' }),
    /** Stable across versions so answers can be compared over time. */
    fieldKey: text('field_key').notNull(),
    fieldType: text('field_type', { enum: FORM_FIELD_TYPES }).notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    isRequired: boolean('is_required').notNull().default(false),
    sensitivity: text('sensitivity', { enum: SENSITIVITIES }).notNull().default('standard'),
    /** { options: [{ key, label }], maxLength, min, max, placeholder } */
    config: jsonb('config').notNull().default({}),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [
    unique('form_fields_version_key').on(t.formVersionId, t.fieldKey),
    unique('form_fields_version_order').on(t.formVersionId, t.sortOrder),
    check('form_fields_key_format', sql`field_key ~ '^[a-z][a-z0-9_]{1,62}$'`),
    check('form_fields_type_check', oneOf('field_type', FORM_FIELD_TYPES)),
    check('form_fields_sensitivity_check', oneOf('sensitivity', SENSITIVITIES)),
    check('form_fields_label_length', sql`length(btrim(label)) BETWEEN 1 AND 300`),
  ],
);

export const formResponses = pgTable(
  'form_responses',
  {
    id: pk(),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references((): AnyPgColumn => formVersions.id),
    /** NULL only for truly anonymous forms. */
    personId: uuid('person_id').references((): AnyPgColumn => people.id),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    submittedAt: tstz('submitted_at').notNull().defaultNow(),
  },
  (t) => [index('form_responses_person').on(t.personId, t.submittedAt.desc())],
);

/** One row per sensitivity tier present in a response — the permission boundary is the tier. */
export const formAnswerSets = pgTable(
  'form_answer_sets',
  {
    responseId: uuid('response_id')
      .notNull()
      .references((): AnyPgColumn => formResponses.id, { onDelete: 'cascade' }),
    sensitivity: text('sensitivity', { enum: SENSITIVITIES }).notNull(),
    /** { "<field_key>": AnswerValue } validated against the version's fields. */
    answers: jsonb('answers').notNull(),
    /** V1: encryption key version for encrypted confidential sets. */
    keyVersion: smallint('key_version'),
  },
  (t) => [
    primaryKey({ name: 'form_answer_sets_pk', columns: [t.responseId, t.sensitivity] }),
    check('form_answer_sets_sensitivity_check', oneOf('sensitivity', SENSITIVITIES)),
  ],
);
