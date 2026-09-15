import { sql } from 'drizzle-orm';
import { bigint, check, index, inet, jsonb, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { oneOf, tstz } from '../columns';
import { ACTOR_TYPES, AUDIT_CATEGORIES } from '../enums';
import { users } from './iam';
import { people } from './people';

/**
 * Append-only audit and access log (docs/03 §4.14). The application role receives INSERT only
 * in production; retention (IP/user-agent nulling after 90 days) runs under a separate role.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    /** Internal only — never exposed. */
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    category: text('category', { enum: AUDIT_CATEGORIES }).notNull(),
    action: text('action').notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorUserId: uuid('actor_user_id').references((): AnyPgColumn => users.id),
    actorPersonId: uuid('actor_person_id').references((): AnyPgColumn => people.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary'),
    /** Redacted per field policy — never journal content. */
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    reason: text('reason'),
    requestId: text('request_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    check('audit_category_check', oneOf('category', AUDIT_CATEGORIES)),
    check('audit_actor_type_check', oneOf('actor_type', ACTOR_TYPES)),
    index('audit_by_entity').on(t.entityType, t.entityId, t.occurredAt.desc()),
    index('audit_by_actor').on(t.actorUserId, t.occurredAt.desc()),
    index('audit_by_time').using('brin', sql`occurred_at`),
  ],
);
