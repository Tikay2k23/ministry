import type { NextConfig } from 'next';

/**
 * Baseline security headers for every route.
 * A nonce-based Content-Security-Policy is added in milestone M5 (hardening),
 * see docs/02-system-architecture.md §8.2.
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
  // Database drivers load native/WASM assets at runtime and must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
