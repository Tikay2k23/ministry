import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, scrubUrl } from '@/lib/sentry-scrub';

describe('Sentry privacy scrubbing', () => {
  it('removes query strings and the secrets in public link paths', () => {
    expect(scrubUrl('https://app.example.org/k/Zm9vYmFyYmF6?utm=1')).toBe('https://app.example.org/k/[redacted]');
    expect(scrubUrl('/a/abcDEF123_-xyz/report')).toBe('/a/[redacted]/report');
    expect(scrubUrl('/pray/7K3M9Q2P')).toBe('/pray/[redacted]');
    expect(scrubUrl('/j/7K3M9Q2P')).toBe('/j/[redacted]');
    expect(scrubUrl('/app/people/0190-uuid')).toBe('/app/people/0190-uuid');
  });

  it('strips request data, user details and query parameters from error events', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://app.example.org/api/public/journal?code=7K3M9Q2P',
        cookies: { gt_pk: 'secret' },
        headers: { authorization: 'Bearer x' },
        data: '{"answers":{"prayer":"private"}}',
        query_string: 'code=7K3M9Q2P',
      },
      user: { id: 'u1', email: 'juan@example.org', ip_address: '203.0.113.9' },
      exception: { values: [{ type: 'DrizzleQueryError', value: 'Failed query: select 1 where phone = $1\nparams: +639171234567' }] },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request).toEqual({ url: 'https://app.example.org/api/public/journal' });
    expect(scrubbed.user).toEqual({ id: 'u1' });
    expect(JSON.stringify(scrubbed)).not.toContain('+639171234567');
    expect(scrubbed.exception?.values?.[0]?.value).toContain('Failed query: select 1');
  });

  it('drops console breadcrumbs and scrubs navigation URLs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'anything' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'navigation', data: { from: '/k/secret-token', to: '/app' } })?.data).toEqual({
      from: '/k/[redacted]',
      to: '/app',
    });
  });
});
