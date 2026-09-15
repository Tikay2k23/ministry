import { describe, expect, it } from 'vitest';
import { fromUpstash } from '@/server/modules/public/rate-limit';

describe('Upstash rate limits', () => {
  const rule = { limit: 5, windowSeconds: 15 * 60 };

  it('counts attempts within the limit', () => {
    expect(fromUpstash({ success: true, remaining: 3, reset: 60_000 }, rule, 0)).toEqual({ allowed: true, hits: 2, retryAfterSeconds: 60 });
  });

  it('blocks past the limit and says when to try again', () => {
    expect(fromUpstash({ success: false, remaining: 0, reset: 90_500 }, rule, 0)).toEqual({ allowed: false, hits: 6, retryAfterSeconds: 91 });
  });

  it('never asks anyone to wait less than a second', () => {
    expect(fromUpstash({ success: false, remaining: 0, reset: 0 }, rule, 5_000).retryAfterSeconds).toBe(1);
  });
});
