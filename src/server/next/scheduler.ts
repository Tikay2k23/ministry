import 'server-only';
import { getEnv } from '../env';
import { logger } from '../logger';
import { JOBS } from '../modules/scheduler/jobs';
import { runDueJobs } from '../modules/scheduler/scheduler.service';
import { getDb } from './db';

/**
 * SCHEDULER_MODE=in_process: run due background jobs every minute inside this server process
 * (started from src/instrumentation.ts). Uses the same process-wide database as requests.
 * A failed job is logged by runDueJobs.
 */

const TICK_MS = 60_000;
const FIRST_TICK_DELAY_MS = 15_000;

interface SchedulerState {
  running: boolean;
  timer: ReturnType<typeof setInterval>;
}

const globalForScheduler = globalThis as unknown as { __gentouchScheduler?: SchedulerState };

export function startInProcessScheduler(): void {
  let mode: string;
  try {
    mode = getEnv().SCHEDULER_MODE;
  } catch (error) {
    logger.error('Background jobs not started: the environment is not configured', error);
    return;
  }
  if (mode !== 'in_process' || globalForScheduler.__gentouchScheduler) return;

  const state = { running: false } as SchedulerState;
  const tick = async () => {
    if (state.running) return; // a slow tick is still going: skip this one
    state.running = true;
    try {
      await runDueJobs(getDb(), JOBS, new Date());
    } catch (error) {
      logger.error('Background job tick failed', error);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), TICK_MS);
  state.timer.unref?.();
  setTimeout(() => void tick(), FIRST_TICK_DELAY_MS).unref?.();
  globalForScheduler.__gentouchScheduler = state;
  logger.info('Background jobs run every minute in this process');
}
