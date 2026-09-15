import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import { CARE_KINDS, CARE_STATUSES, CARE_VISIBILITIES } from '../enums';
import { users } from './iam';
import { people } from './people';

/** Generic care follow-ups, reused by future modules (docs/03 §4.8). */
export const careFollowups = pgTable(
  'care_followups',
  {
    id: pk(),
    /** Who this is about. */
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    kind: text('kind', { enum: CARE_KINDS }).notNull(),
    /** Informational link back to the source record (deliberately polymorphic). */
    sourceType: text('source_type'),
    sourceRef: text('source_ref'),
    /** Usually the direct leader or a coordinator; NULL = the pastoral care pool. */
    assignedToPersonId: uuid('assigned_to_person_id').references((): AnyPgColumn => people.id),
    status: text('status', { enum: CARE_STATUSES }).notNull().default('open'),
    visibility: text('visibility', { enum: CARE_VISIBILITIES }).notNull().default('leadership'),
    /** Non-sensitive summary, e.g. "No journal for 3 days". */
    summary: text('summary').notNull(),
    /** Sensitive; permission-gated. */
    resolutionNote: text('resolution_note'),
    dedupeKey: text('dedupe_key').unique(),
    dueOn: date('due_on'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    resolvedBy: uuid('resolved_by').references((): AnyPgColumn => users.id),
    resolvedAt: tstz('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('care_followups_kind_check', oneOf('kind', CARE_KINDS)),
    check('care_followups_status_check', oneOf('status', CARE_STATUSES)),
    check('care_followups_visibility_check', oneOf('visibility', CARE_VISIBILITIES)),
    index('care_open_by_assignee').on(t.assignedToPersonId, t.createdAt.desc()).where(sql`status IN ('open', 'in_progress')`),
    index('care_by_person').on(t.personId, t.createdAt.desc()),
  ],
);
