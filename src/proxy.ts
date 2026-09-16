import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, newNonce } from './server/security/csp';

/**
 * Runs before every page (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md):
 * a nonce-based Content-Security-Policy per request (docs/02 §8.2). Next.js reads the nonce from
 * the request's header and puts it on its own scripts, so every page is rendered per request
 * (src/app/layout.tsx). The other security headers are in next.config.ts.
 */
export function proxy(request: NextRequest) {
  const policy = buildContentSecurityPolicy({
    nonce: newNonce(),
    isDevelopment: process.env.NODE_ENV === 'development',
    appUrl: process.env.APP_URL,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything but API routes (JSON) and build assets, so not-found pages carry the policy too.
      source: '/((?!api/|_next/static|_next/image).*)',
      // Link prefetches aren't documents and don't need a policy of their own.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
