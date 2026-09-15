import { sql } from 'drizzle-orm';
import { hmacHex } from '../../crypto';
import { queryRows, type Executor } from '../../db/client';
import { AppError } from '../../errors';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/** Common limits for public endpoints (docs/02 §4 "Anti-abuse layers"). */
export const RATE_LIMITS = {
  identifyPerIp: { limit: 5, windowSeconds: 15 * 60 },
  identifyPerPhone: { limit: 5, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 10, windowSeconds: 60 * 60 },
  submitPerPerson: { limit: 10, windowSeconds: 60 },
  leaderSearchPerIp: { limit: 60, windowSeconds: 60 },
  personalLinkPerIp: { limit: 10, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in an UNLOGGED table. Subjects are HMAC'd, so raw phone numbers and IP
 * addresses are never stored. Returns whether this hit is within the limit.
 */
export async function hitRateLimit(executor: Executor, subject: string, rule: RateLimitRule, now: Date) {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await queryRows<{ hits: number }>(
    executor,
    sql`INSERT INTO rate_limit_buckets (bucket_key, window_start, hits)
        VALUES (${hmacHex(subject, 'rate-limit')}, ${windowStart.toISOString()}::timestamptz, 1)
        ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = rate_limit_buckets.hits + 1
        RETURNING hits`,
  );
  if (Math.random() < 0.01) {
    await executor.execute(sql`DELETE FROM rate_limit_buckets WHERE window_start < ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`);
  }
  const hits = Number(row?.hits ?? 1);
  return {
    allowed: hits <= rule.limit,
    hits,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)),
  };
}

export async function assertRateLimit(executor: Executor, subject: string, rule: RateLimitRule, now: Date) {
  const result = await hitRateLimit(executor, subject, rule, now);
  if (!result.allowed) {
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    throw new AppError('RATE_LIMITED', `Too many tries. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`, {
      meta: { retryAfterSeconds: result.retryAfterSeconds },
    });
  }
  return result;
}
