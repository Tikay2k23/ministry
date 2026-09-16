import * as Sentry from '@sentry/nextjs';

/**
 * Next.js instrumentation hook: runs once when a server instance starts
 * (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
 * - Error tracking (Sentry), when SENTRY_DSN is set.
 * - The in-app scheduler for background jobs when SCHEDULER_MODE=in_process (docs/02 §7).
 *   Never during `next build`.
 * - In development, a warning when the database is missing migrations.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./sentry.server.config');
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NODE_ENV === 'development') {
    const { warnAboutPendingMigrations } = await import('./server/next/migrations-check');
    void warnAboutPendingMigrations();
  }
  const { startInProcessScheduler } = await import('./server/next/scheduler');
  startInProcessScheduler();
}

/** Errors that Next.js itself catches while rendering, e.g. in a Server Component. */
export const onRequestError = Sentry.captureRequestError;
