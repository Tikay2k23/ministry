import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { JOBS } from '@/server/modules/scheduler/jobs';
import { listJobStatus, runDueJobs, type JobDefinition } from '@/server/modules/scheduler/scheduler.service';
import { createTestDatabase } from '../helpers/db';
import { buildWorld } from '../helpers/world';

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
  await buildWorld(handle.db);
});

afterAll(async () => {
  await handle.close();
});

const at = (iso: string) => new Date(iso);

describe('background jobs (docs/02 §7 note)', () => {
  it('runs every registered job on the first tick', async () => {
    const results = await runDueJobs(handle.db, JOBS, at('2026-09-16T01:00:00Z'));
    expect(results.map((r) => [r.key, r.status, r.error ?? null])).toEqual(JOBS.map((job) => [job.key, 'ok', null]));
  });

  it('does nothing on a repeated tick before any job is due again', async () => {
    const results = await runDueJobs(handle.db, JOBS, at('2026-09-16T01:00:30Z'));
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('runs each job again once its own interval has passed', async () => {
    const results = await runDueJobs(handle.db, JOBS, at('2026-09-16T01:06:00Z'));
    expect(results.filter((r) => r.status === 'ok').map((r) => r.key).sort()).toEqual([
      'journal.ledger',
      'notifications.deliver',
      'prayer.check_overdue',
      'prayer.slot_reminders',
    ]);

    const status = await listJobStatus(handle.db);
    expect(status.find((s) => s.jobKey === 'journal.ledger')?.runCount).toBe(2);
    expect(status.find((s) => s.jobKey === 'tokens.cleanup')?.runCount).toBe(1);
    expect(status.every((s) => s.lastStatus === 'ok' && s.lockedUntil === null)).toBe(true);
  });

  it('stores a failure without personal data and retries it after five minutes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: JobDefinition[] = [
      {
        key: 'test.failing',
        everyMinutes: 60,
        run: async () => {
          throw Object.assign(new Error('Failed query: select 1\nparams: +639171234567'), { query: 'select 1', params: ['+639171234567'] });
        },
      },
    ];

    const [result] = await runDueJobs(handle.db, failing, at('2026-09-16T02:00:00Z'));
    expect(result?.status).toBe('error');
    expect(result?.error).not.toContain('+639171234567');

    const status = (await listJobStatus(handle.db)).find((s) => s.jobKey === 'test.failing');
    expect(status?.lastStatus).toBe('error');
    expect(status?.lastError).not.toContain('+639171234567');
    expect(status?.nextRunAt.toISOString()).toBe('2026-09-16T02:05:00.000Z');
    vi.restoreAllMocks();
  });
});
