import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { scheduledJobs } from '../../db/schema';
import { errorSummary, logger } from '../../logger';
import { alertJobFailure } from './alerts';

/**
 * In-app scheduler (docs/02 §7, M3 note). Replaces the planned Graphile Worker, which needs a
 * network PostgreSQL connection and so can't run against the embedded PGlite used locally.
 *
 * `runDueJobs` is called every minute — by a timer inside the server (SCHEDULER_MODE=in_process)
 * or by an external cron hitting /api/cron/tick (SCHEDULER_MODE=external). Each job is claimed
 * with a lease in a single UPDATE, so ticks from several instances never run a job twice. Jobs
 * take the tick time explicitly and are idempotent, so a missed or repeated tick is harmless.
 */

export interface JobDefinition {
  key: string;
  /** What the job does, in words for System health and failure alerts. */
  label: string;
  everyMinutes: number;
  run(db: Database, now: Date): Promise<object | void>;
}

export interface JobRunResult {
  key: string;
  status: 'ok' | 'error' | 'skipped';
  summary?: object;
  error?: string;
}

/** A crashed run's lease expires after this long, and the job becomes claimable again. */
const LEASE_MINUTES = 10;
const RETRY_AFTER_ERROR_MINUTES = 5;

export async function runDueJobs(db: Database, jobs: readonly JobDefinition[], now: Date = new Date()): Promise<JobRunResult[]> {
  if (jobs.length === 0) return [];
  await db
    .insert(scheduledJobs)
    .values(jobs.map((job) => ({ jobKey: job.key, nextRunAt: now })))
    .onConflictDoNothing();

  const results: JobRunResult[] = [];
  for (const job of jobs) {
    const [claimed] = await db
      .update(scheduledJobs)
      .set({ lockedUntil: new Date(now.getTime() + LEASE_MINUTES * 60_000), lastStartedAt: now, lastStatus: 'running' })
      .where(
        and(
          eq(scheduledJobs.jobKey, job.key),
          lte(scheduledJobs.nextRunAt, now),
          or(isNull(scheduledJobs.lockedUntil), lt(scheduledJobs.lockedUntil, now)),
        ),
      )
      .returning({ jobKey: scheduledJobs.jobKey });
    if (!claimed) {
      results.push({ key: job.key, status: 'skipped' });
      continue;
    }

    try {
      const summary = (await job.run(db, now)) ?? {};
      await db
        .update(scheduledJobs)
        .set({
          lockedUntil: null,
          lastFinishedAt: new Date(),
          lastStatus: 'ok',
          lastError: null,
          lastSummary: summary,
          runCount: sql`${scheduledJobs.runCount} + 1`,
          nextRunAt: new Date(now.getTime() + job.everyMinutes * 60_000),
        })
        .where(eq(scheduledJobs.jobKey, job.key));
      results.push({ key: job.key, status: 'ok', summary });
    } catch (error) {
      const message = errorSummary(error);
      logger.error('Background job failed', error, { job: job.key });
      await db
        .update(scheduledJobs)
        .set({
          lockedUntil: null,
          lastFinishedAt: new Date(),
          lastStatus: 'error',
          lastError: message,
          runCount: sql`${scheduledJobs.runCount} + 1`,
          failureCount: sql`${scheduledJobs.failureCount} + 1`,
          nextRunAt: new Date(now.getTime() + Math.min(job.everyMinutes, RETRY_AFTER_ERROR_MINUTES) * 60_000),
        })
        .where(eq(scheduledJobs.jobKey, job.key));
      results.push({ key: job.key, status: 'error', error: message });
      try {
        await alertJobFailure(db, job, message, now);
      } catch (alertError) {
        logger.error('Could not alert administrators about a failed job', alertError, { job: job.key });
      }
    }
  }
  return results;
}

/** For System health: when each job last ran and how it went. */
export async function listJobStatus(db: Database) {
  return db.select().from(scheduledJobs).orderBy(asc(scheduledJobs.jobKey));
}
