import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';
import { setErrorReporter } from '@/server/logger';

/**
 * Server error tracking (Sentry), loaded from src/instrumentation.ts. Off unless SENTRY_DSN is
 * set. Errors only (no performance tracing), with personal data scrubbed before sending.
 */

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

if (dsn) {
  // Unexpected errors caught by our route and action wrappers never reach Next.js's error
  // handling, so the logger reports them.
  setErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context });
  });
}
