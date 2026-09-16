import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, newNonce } from '@/server/security/csp';

const directives = (policy: string) => Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0]!, d.split(' ').slice(1)]));

describe('Content-Security-Policy (docs/02 §8.2)', () => {
  it('allows only scripts carrying the nonce, and what they load', () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: 'abc123', isDevelopment: false, appUrl: 'https://portal.gentouch.ph' }));
    expect(csp['script-src']).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
  });

  it('forbids framing, plugins, <base> changes and posting forms elsewhere', () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false }));
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it("adds 'unsafe-eval' only in development, where React's error overlay needs it", () => {
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: true })).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false })).not.toContain("'unsafe-eval'");
  });

  it('upgrades insecure requests only when the app is served over https', () => {
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false, appUrl: 'https://portal.gentouch.ph' })).toContain('upgrade-insecure-requests');
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false, appUrl: 'http://localhost:3000' })).not.toContain('upgrade-insecure-requests');
  });

  it("lets the browser report errors to Sentry's ingest host, and nowhere else", () => {
    const withSentry = directives(
      buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false, sentryDsn: 'https://publickey@o123.ingest.us.sentry.io/456' }),
    );
    expect(withSentry['connect-src']).toEqual(["'self'", 'https://o123.ingest.us.sentry.io']);
    expect(directives(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false, sentryDsn: 'not a url' }))['connect-src']).toEqual(["'self'"]);
  });

  it('makes a different, unguessable nonce each time', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce.length).toBeGreaterThanOrEqual(32);
  });
});
