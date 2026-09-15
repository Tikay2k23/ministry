/**
 * Next.js instrumentation hook: runs once when a server instance starts
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * Starts the in-app scheduler for background jobs when SCHEDULER_MODE=in_process
 * (docs/02 §7, M3 note). Never during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startInProcessScheduler } = await import('./server/next/scheduler');
  startInProcessScheduler();
}
