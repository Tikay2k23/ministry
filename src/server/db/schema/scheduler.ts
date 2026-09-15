import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, tstz } from '../columns';
import { JOB_RUN_STATUSES } from '../enums';

/**
 * Background job bookkeeping for the in-app scheduler (docs/02 §7, M3 note). One row per job:
 * a run is claimed by setting `locked_until` (a lease) in a single UPDATE, so concurrent ticks
 * from several server instances never run the same job twice.
 */
export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    jobKey: text('job_key').primaryKey(),
    nextRunAt: tstz('next_run_at').notNull(),
    lockedUntil: tstz('locked_until'),
    lastStartedAt: tstz('last_started_at'),
    lastFinishedAt: tstz('last_finished_at'),
    lastStatus: text('last_status', { enum: JOB_RUN_STATUSES }),
    lastError: text('last_error'),
    lastSummary: jsonb('last_summary'),
    runCount: integer('run_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
  },
  () => [check('scheduled_jobs_status_check', sql`last_status IS NULL OR ${oneOf('last_status', JOB_RUN_STATUSES)}`)],
);
