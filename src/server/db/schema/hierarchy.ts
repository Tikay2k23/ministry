import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import { LEADER_CHANGE_SOURCES, LEADER_CHANGE_STATUSES, LEADERSHIP_CHANGE_TYPES } from '../enums';
import { users } from './iam';
import { people } from './people';

/**
 * Current leadership tree — adjacency list, the source of truth (docs/03 §3).
 * Maintained only by HierarchyService under a transaction-level advisory lock.
 */
export const hierarchyNodes = pgTable(
  'hierarchy_nodes',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references((): AnyPgColumn => people.id),
    /** RESTRICT: a leader with a direct group cannot be removed (BR-H-04). */
    parentPersonId: uuid('parent_person_id').references((): AnyPgColumn => hierarchyNodes.personId),
    depth: smallint('depth').notNull(),
    /** Derived: ancestor at the configured primary-leader depth (self if equal, NULL if shallower). */
    primaryLeaderPersonId: uuid('primary_leader_person_id').references(
      (): AnyPgColumn => hierarchyNodes.personId,
    ),
    /** Appears in the public leader selector (FR-LDR-08). */
    acceptsMembers: boolean('accepts_members').notNull().default(false),
    placedAt: tstz('placed_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('hierarchy_nodes_depth_check', sql`depth >= 0`),
    check('hierarchy_nodes_not_self_parent', sql`parent_person_id IS NULL OR parent_person_id <> person_id`),
    check('hierarchy_nodes_root_depth', sql`(parent_person_id IS NULL) = (depth = 0)`),
    index('hierarchy_children').on(t.parentPersonId),
    index('hierarchy_primary').on(t.primaryLeaderPersonId),
    index('hierarchy_acceptors').on(t.personId).where(sql`accepts_members`),
  ],
);

/** Derived index of every ancestor/descendant pair, including depth-0 self rows. */
export const hierarchyClosure = pgTable(
  'hierarchy_closure',
  {
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references((): AnyPgColumn => hierarchyNodes.personId, { onDelete: 'cascade' }),
    descendantId: uuid('descendant_id')
      .notNull()
      .references((): AnyPgColumn => hierarchyNodes.personId, { onDelete: 'cascade' }),
    depth: smallint('depth').notNull(),
  },
  (t) => [
    primaryKey({ name: 'hierarchy_closure_pk', columns: [t.ancestorId, t.descendantId] }),
    check('hierarchy_closure_depth_check', sql`depth >= 0`),
    check('hierarchy_closure_self_depth', sql`(depth = 0) = (ancestor_id = descendant_id)`),
    index('closure_by_descendant').on(t.descendantId, t.depth),
    index('closure_by_ancestor_depth').on(t.ancestorId, t.depth),
  ],
);

export const leaderChangeRequests = pgTable(
  'leader_change_requests',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    fromLeaderPersonId: uuid('from_leader_person_id').references((): AnyPgColumn => people.id),
    toLeaderPersonId: uuid('to_leader_person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    source: text('source', { enum: LEADER_CHANGE_SOURCES }).notNull(),
    requestedByUserId: uuid('requested_by_user_id').references((): AnyPgColumn => users.id),
    reason: text('reason'),
    status: text('status', { enum: LEADER_CHANGE_STATUSES }).notNull().default('pending'),
    decidedBy: uuid('decided_by').references((): AnyPgColumn => users.id),
    decidedAt: tstz('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('leader_change_source_check', oneOf('source', LEADER_CHANGE_SOURCES)),
    check('leader_change_status_check', oneOf('status', LEADER_CHANGE_STATUSES)),
    check('leader_change_not_self', sql`to_leader_person_id <> person_id`),
    check('leader_change_decision_consistency', sql`(status = 'pending') = (decided_at IS NULL)`),
    uniqueIndex('leader_change_one_pending').on(t.personId).where(sql`status = 'pending'`),
    index('leader_change_inbox').on(t.toLeaderPersonId).where(sql`status = 'pending'`),
  ],
);

/** Append-only record of every hierarchy change. */
export const leadershipHistory = pgTable(
  'leadership_history',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    previousLeaderPersonId: uuid('previous_leader_person_id').references((): AnyPgColumn => people.id),
    newLeaderPersonId: uuid('new_leader_person_id').references((): AnyPgColumn => people.id),
    changeType: text('change_type', { enum: LEADERSHIP_CHANGE_TYPES }).notNull(),
    movedWithSubtree: boolean('moved_with_subtree').notNull().default(false),
    effectiveAt: tstz('effective_at').notNull().defaultNow(),
    reason: text('reason'),
    requestId: uuid('request_id').references((): AnyPgColumn => leaderChangeRequests.id),
    /** Groups the rows written by one bulk operation. */
    operationId: uuid('operation_id').notNull(),
    /** NULL = system. */
    changedBy: uuid('changed_by').references((): AnyPgColumn => users.id),
  },
  (t) => [
    check('leadership_history_change_type_check', oneOf('change_type', LEADERSHIP_CHANGE_TYPES)),
    index('leadership_history_person').on(t.personId, t.effectiveAt.desc()),
    index('leadership_history_leader').on(t.newLeaderPersonId, t.effectiveAt.desc()),
  ],
);
