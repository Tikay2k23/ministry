import 'server-only';
import { getEnv } from '../env';
import { JOBS } from '../modules/scheduler/jobs';
import { runDueJobs } from '../modules/scheduler/scheduler.service';
import { getDb } from './db';

/**
 * SCHEDULER_MODE=in_process: run due background jobs every minute inside this server process
 * (started from src/instrumentation.ts). Uses the same process-wide database as requests.
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
    console.error('[scheduler] not started: the environment is not configured', error);
    return;
  }
  if (mode !== 'in_process' || globalForScheduler.__gentouchScheduler) return;

  const state = { running: false } as SchedulerState;
  const tick = async () => {
    if (state.running) return; // a slow tick is still going: skip this one
    state.running = true;
    try {
      const results = await runDueJobs(getDb(), JOBS, new Date());
      for (const result of results) {
        if (result.status === 'error') console.error(`[scheduler] ${result.key}: ${result.error}`);
      }
    } catch (error) {
      console.error('[scheduler] tick failed', error);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), TICK_MS);
  state.timer.unref?.();
  setTimeout(() => void tick(), FIRST_TICK_DELAY_MS).unref?.();
  globalForScheduler.__gentouchScheduler = state;
  console.info('[scheduler] background jobs run every minute in this process');
}
