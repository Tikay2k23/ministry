import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz, updatedAt } from '../columns';
import {
  DAY_CARE_STATUSES,
  EXCUSE_REASONS,
  JOURNAL_CHANNELS,
  JOURNAL_TIMINGS,
  PAUSE_REASONS,
  REVIEW_STATUSES,
  SUBMISSION_STATUSES,
} from '../enums';
import { formResponses } from './forms';
import { users } from './iam';
import { people } from './people';
import { entryCodes } from './public-access';

/** docs/03-database.md §4.7 */

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    journalDate: date('journal_date').notNull(),
    /** The current revision's response. */
    formResponseId: uuid('form_response_id')
      .notNull()
      .unique()
      .references((): AnyPgColumn => formResponses.id),
    firstSubmittedAt: tstz('first_submitted_at').notNull(),
    lastSubmittedAt: tstz('last_submitted_at').notNull(),
    revisionNo: smallint('revision_no').notNull().default(1),
    timing: text('timing', { enum: JOURNAL_TIMINGS }).notNull(),
    channel: text('channel', { enum: JOURNAL_CHANNELS }).notNull(),
    entryCodeId: uuid('entry_code_id').references((): AnyPgColumn => entryCodes.id),
    proxyUserId: uuid('proxy_user_id').references((): AnyPgColumn => users.id),
    contentPurgedAt: tstz('content_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('journal_entries_person_date').on(t.personId, t.journalDate),
    check('journal_entries_timing_check', oneOf('timing', JOURNAL_TIMINGS)),
    check('journal_entries_channel_check', oneOf('channel', JOURNAL_CHANNELS)),
    check('journal_entries_proxy_consistency', sql`(channel = 'proxy') = (proxy_user_id IS NOT NULL)`),
    check('journal_entries_revision_positive', sql`revision_no >= 1`),
  ],
);

export const journalEntryRevisions = pgTable(
  'journal_entry_revisions',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references((): AnyPgColumn => journalEntries.id),
    revisionNo: smallint('revision_no').notNull(),
    formResponseId: uuid('form_response_id')
      .notNull()
      .unique()
      .references((): AnyPgColumn => formResponses.id),
    /** Replays of the same submission return the original result. */
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    submittedAt: tstz('submitted_at').notNull(),
  },
  (t) => [primaryKey({ name: 'journal_entry_revisions_pk', columns: [t.entryId, t.revisionNo] })],
);

/** The accountability ledger: one narrow row per person per day. NO content here. */
export const journalDays = pgTable(
  'journal_days',
  {
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    journalDate: date('journal_date').notNull(),
    isExpected: boolean('is_expected').notNull(),
    submissionStatus: text('submission_status', { enum: SUBMISSION_STATUSES }).notNull(),
    reviewStatus: text('review_status', { enum: REVIEW_STATUSES }).notNull().default('none'),
    careStatus: text('care_status', { enum: DAY_CARE_STATUSES }).notNull().default('none'),
    entryId: uuid('entry_id')
      .unique()
      .references((): AnyPgColumn => journalEntries.id),
    excuseReason: text('excuse_reason', { enum: EXCUSE_REASONS }),
    /** Snapshots of the person's place in the tree on that day (history stays correct after moves). */
    leaderPersonId: uuid('leader_person_id').references((): AnyPgColumn => people.id),
    primaryLeaderPersonId: uuid('primary_leader_person_id').references((): AnyPgColumn => people.id),
    hierarchyPath: uuid('hierarchy_path')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    finalizedAt: tstz('finalized_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'journal_days_pk', columns: [t.personId, t.journalDate] }),
    check('journal_days_submission_check', oneOf('submission_status', SUBMISSION_STATUSES)),
    check('journal_days_review_check', oneOf('review_status', REVIEW_STATUSES)),
    check('journal_days_care_check', oneOf('care_status', DAY_CARE_STATUSES)),
    check('journal_days_excuse_check', sql`excuse_reason IS NULL OR ${oneOf('excuse_reason', EXCUSE_REASONS)}`),
    check('journal_days_entry_consistency', sql`(submission_status IN ('submitted', 'late')) = (entry_id IS NOT NULL)`),
    check('journal_days_excuse_consistency', sql`(submission_status = 'excused') = (excuse_reason IS NOT NULL)`),
    check('journal_days_pending_open', sql`submission_status <> 'pending' OR finalized_at IS NULL`),
    check('journal_days_missed_final', sql`submission_status <> 'missed' OR finalized_at IS NOT NULL`),
    check('journal_days_expected_consistency', sql`is_expected OR submission_status IN ('submitted', 'late', 'excused')`),
    check('journal_days_review_needs_entry', sql`review_status = 'none' OR entry_id IS NOT NULL`),
    index('journal_days_by_leader').on(t.journalDate, t.leaderPersonId),
    index('journal_days_branch').using('gin', t.journalDate, t.hierarchyPath),
    index('journal_days_open').on(t.journalDate).where(sql`finalized_at IS NULL`),
    index('journal_days_awaiting').on(t.leaderPersonId, t.journalDate).where(sql`review_status = 'awaiting'`),
  ],
);

export const journalReviews = pgTable(
  'journal_reviews',
  {
    id: pk(),
    entryId: uuid('entry_id')
      .notNull()
      .references((): AnyPgColumn => journalEntries.id),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references((): AnyPgColumn => users.id),
    reviewedAt: tstz('reviewed_at').notNull().defaultNow(),
    /** Private leader note — same visibility as standard journal content. */
    comment: text('comment'),
    shareWithPerson: boolean('share_with_person').notNull().default(false),
    flaggedFollowUp: boolean('flagged_follow_up').notNull().default(false),
  },
  (t) => [unique('journal_reviews_entry_reviewer').on(t.entryId, t.reviewerUserId)],
);

/** Personal pauses (leave, sickness, travel). Overlap is prevented by an exclusion constraint (migration 0004). */
export const journalPauses = pgTable(
  'journal_pauses',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    startsOn: date('starts_on').notNull(),
    /** NULL = until further notice. */
    endsOn: date('ends_on'),
    reason: text('reason', { enum: PAUSE_REASONS }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    cancelledAt: tstz('cancelled_at'),
  },
  (t) => [
    check('journal_pauses_reason_check', oneOf('reason', PAUSE_REASONS)),
    check('journal_pauses_dates', sql`ends_on IS NULL OR ends_on >= starts_on`),
    index('journal_pauses_person').on(t.personId).where(sql`cancelled_at IS NULL`),
  ],
);

/**
 * Ledger maintenance bookkeeping: which days have been opened and closed, and whether open
 * days need re-synchronising after a structural change. Makes maintenance idempotent and cheap.
 */
export const journalLedgerRuns = pgTable('journal_ledger_runs', {
  journalDate: date('journal_date').primaryKey(),
  openedAt: tstz('opened_at').notNull(),
  closedAt: tstz('closed_at'),
  needsResync: boolean('needs_resync').notNull().default(false),
  expectedCount: integer('expected_count'),
  missedCount: integer('missed_count'),
});
