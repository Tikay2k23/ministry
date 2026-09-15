import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz } from '../columns';
import { IMPORT_KINDS, IMPORT_ROW_OUTCOMES, IMPORT_STATUSES } from '../enums';
import { users } from './iam';
import { people } from './people';

/** CSV import of people with hierarchy (docs/03 §4.15). */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: pk(),
    kind: text('kind', { enum: IMPORT_KINDS }).notNull(),
    status: text('status', { enum: IMPORT_STATUSES }).notNull(),
    fileName: text('file_name').notNull(),
    options: jsonb('options').notNull().default({}),
    stats: jsonb('stats').notNull().default({}),
    createdBy: uuid('created_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    completedAt: tstz('completed_at'),
  },
  () => [
    check('import_jobs_kind_check', oneOf('kind', IMPORT_KINDS)),
    check('import_jobs_status_check', oneOf('status', IMPORT_STATUSES)),
  ],
);

/** Raw rows contain personal data — purged 30 days after the job completes. */
export const importRows = pgTable(
  'import_rows',
  {
    importJobId: uuid('import_job_id')
      .notNull()
      .references((): AnyPgColumn => importJobs.id, { onDelete: 'cascade' }),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').notNull(),
    normalized: jsonb('normalized'),
    outcome: text('outcome', { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    messages: jsonb('messages').notNull().default([]),
    matchedPersonId: uuid('matched_person_id').references((): AnyPgColumn => people.id),
    createdPersonId: uuid('created_person_id').references((): AnyPgColumn => people.id),
  },
  (t) => [
    primaryKey({ name: 'import_rows_pk', columns: [t.importJobId, t.rowNo] }),
    check('import_rows_outcome_check', oneOf('outcome', IMPORT_ROW_OUTCOMES)),
  ],
);
