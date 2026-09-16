/**
 * The Content-Security-Policy for pages (docs/02 §8.2), built per request in src/proxy.ts.
 *
 * - Scripts: only those carrying this request's nonce, and what they load ('strict-dynamic').
 *   Next.js adds the nonce to its own scripts. Development also needs 'unsafe-eval' for React's
 *   error overlays (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * - Styles: 'unsafe-inline' rather than a nonce. Server-rendered `style` attributes (progress bars,
 *   chart colours) can't carry a nonce, and a nonce would switch 'unsafe-inline' off. Inline styles
 *   can't run code, so scripts stay strict.
 * - No framing, plugins, <base> changes, or form posts to other sites.
 */
export interface CspOptions {
  nonce: string;
  isDevelopment: boolean;
  /** The app's public URL: on https, browsers also upgrade any stray http:// subresource. */
  appUrl?: string;
  /** NEXT_PUBLIC_SENTRY_DSN, so the browser may report errors to Sentry's ingest host. */
  sentryDsn?: string;
}

function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({ nonce, isDevelopment, appUrl, sentryDsn }: CspOptions): string {
  const sentry = sentryOrigin(sentryDsn);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${sentry ? ` ${sentry}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(appUrl?.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/** A fresh, unguessable nonce for one request. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}
