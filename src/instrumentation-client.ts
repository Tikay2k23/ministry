import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';

/**
 * Browser error tracking (Sentry), off unless NEXT_PUBLIC_SENTRY_DSN is set
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md).
 * Errors only: no performance tracing, and no session replay, which would record what people type
 * into their journals.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
