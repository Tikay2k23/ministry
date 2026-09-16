import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

/**
 * Security headers for every route (docs/02-system-architecture.md §8.2). The nonce-based
 * Content-Security-Policy is set per request in src/proxy.ts.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // End-to-end tests run their own server beside `npm run dev`, with separate build output (playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Database drivers load native/WASM assets at runtime and must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    // Personal links carry a secret token: never send it onward as a referrer (docs/02 §4).
    const tokenPage = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/a/:token*', headers: tokenPage },
      { source: '/k/:token*', headers: tokenPage },
    ];
  },
};

/**
 * Sentry (src/instrumentation.ts, src/instrumentation-client.ts). Error tracking is switched on by
 * SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN. Source maps are uploaded only when the build has
 * SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT (CI and Vercel).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
