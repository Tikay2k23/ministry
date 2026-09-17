import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import { scheduledJobs } from '../../db/schema';
import { getEnv } from '../../env';
import { notFound } from '../../errors';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { JOBS } from '../scheduler/jobs';
import { listJobStatus } from '../scheduler/scheduler.service';

/**
 * System health (docs/04 A29): when each background job last ran and how it went, whether the
 * scheduler is still ticking, what is waiting to be sent, and how this installation is set up.
 * Never shows secrets: only which providers are in use.
 */

/** No job has started for this long although jobs should run every minute or few: something is stuck. */
const STALLED_AFTER_MINUTES = 15;

export async function getSystemHealth(db: Database, ctx: RequestContext) {
  assertGlobal(ctx, 'settings.manage');
  const env = getEnv();
  const [rows, notificationCounts, size] = await Promise.all([
    listJobStatus(db),
    queryRows<{ waiting: number; failed: number; sent: number }>(
      db,
      sql`SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS waiting,
                 count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS failed,
                 count(*) FILTER (WHERE status IN ('sent', 'partially_sent') AND sent_at > now() - interval '1 day')::int AS sent
            FROM notifications`,
    ),
    queryRows<{ bytes: string }>(db, sql`SELECT pg_database_size(current_database())::text AS bytes`),
  ]);

  const jobs = JOBS.map((job) => {
    const row = rows.find((r) => r.jobKey === job.key);
    return {
      key: job.key,
      label: job.label,
      everyMinutes: job.everyMinutes,
      lastStatus: row?.lastStatus ?? null,
      lastStartedAt: row?.lastStartedAt ?? null,
      lastFinishedAt: row?.lastFinishedAt ?? null,
      nextRunAt: row?.nextRunAt ?? null,
      lastError: row?.lastStatus === 'error' ? row.lastError : null,
      runCount: row?.runCount ?? 0,
      failureCount: row?.failureCount ?? 0,
    };
  });
  const lastTickAt = jobs.reduce<Date | null>((latest, job) => (job.lastStartedAt && (!latest || job.lastStartedAt > latest) ? job.lastStartedAt : latest), null);
  const stalled =
    env.SCHEDULER_MODE !== 'off' && (lastTickAt === null || ctx.now.getTime() - lastTickAt.getTime() > STALLED_AFTER_MINUTES * 60_000);

  return {
    jobs,
    scheduler: { mode: env.SCHEDULER_MODE, lastTickAt, stalled },
    notifications: notificationCounts[0] ?? { waiting: 0, failed: 0, sent: 0 },
    databaseBytes: Number(size[0]?.bytes ?? 0),
    configuration: {
      environment: env.NODE_ENV,
      appUrl: env.APP_URL,
      emailProvider: env.EMAIL_PROVIDER,
      rateLimitStore: env.RATE_LIMIT_STORE,
      errorTracking: Boolean(env.SENTRY_DSN),
      database: env.DATABASE_URL.startsWith('pglite:') ? ('embedded' as const) : ('postgres' as const),
    },
  };
}

export const RunJobInput = z.object({ jobKey: z.string().min(1).max(80) });

/** "Run now": the job becomes due, and the next scheduler tick (within a minute) runs it. */
export async function runJobSoon(db: Database, ctx: RequestContext, raw: unknown) {
  assertGlobal(ctx, 'settings.manage');
  const { jobKey } = parseInput(RunJobInput, raw);
  const job = JOBS.find((j) => j.key === jobKey);
  if (!job) throw notFound('job');
  await db.transaction(async (tx) => {
    await tx
      .insert(scheduledJobs)
      .values({ jobKey, nextRunAt: ctx.now })
      .onConflictDoUpdate({ target: scheduledJobs.jobKey, set: { nextRunAt: ctx.now } });
    await recordAudit(tx, ctx, { category: 'system', action: 'system.job_run_requested', entityType: 'job', entityId: jobKey });
  });
  const [row] = await db.select({ nextRunAt: scheduledJobs.nextRunAt }).from(scheduledJobs).where(eq(scheduledJobs.jobKey, jobKey));
  return { jobKey, nextRunAt: row?.nextRunAt ?? ctx.now };
}
