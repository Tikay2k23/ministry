import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz } from '../columns';
import { UNAVAILABILITY_SOURCES } from '../enums';
import { users } from './iam';
import { people } from './people';

/**
 * Shared scheduling (docs/03 §4.10). Unavailability uses `starts_at`/`ends_at` rather than a
 * `tstzrange` column, like prayer assignments; the GiST index works on the range they form.
 */
export const personUnavailability = pgTable(
  'person_unavailability',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    reason: text('reason'),
    source: text('source', { enum: UNAVAILABILITY_SOURCES }).notNull(),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('unavailability_times', sql`ends_at > starts_at`),
    check('unavailability_source_check', oneOf('source', UNAVAILABILITY_SOURCES)),
    check('unavailability_reason_length', sql`reason IS NULL OR length(reason) <= 200`),
    index('unavailability_lookup').using('gist', t.personId, sql`tstzrange(starts_at, ends_at)`),
  ],
);
