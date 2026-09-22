import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { sql } from 'drizzle-orm';
import { hmacHex } from '../../crypto';
import { queryRows, type Executor } from '../../db/client';
import { getEnv } from '../../env';
import { AppError } from '../../errors';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

/** Common limits for public endpoints (docs/02 §4 "Anti-abuse layers"). */
export const RATE_LIMITS = {
  identifyPerIp: { limit: 5, windowSeconds: 15 * 60 },
  identifyPerPhone: { limit: 5, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 10, windowSeconds: 60 * 60 },
  submitPerPerson: { limit: 10, windowSeconds: 60 },
  /** Journal photos: a few retries per person, and a ceiling per connection so uploads can't be abused. */
  proofUploadPerPerson: { limit: 10, windowSeconds: 15 * 60 },
  proofUploadPerIp: { limit: 60, windowSeconds: 15 * 60 },
  leaderSearchPerIp: { limit: 60, windowSeconds: 60 },
  personalLinkPerIp: { limit: 10, windowSeconds: 15 * 60 },
  prayerRespondPerIp: { limit: 60, windowSeconds: 15 * 60 },
  /** Taking an hour is a write, so it is held tighter than reading or confirming one. */
  prayerClaimPerIp: { limit: 20, windowSeconds: 15 * 60 },
  prayerClaimPerPerson: { limit: 10, windowSeconds: 60 * 60 },
  prayerReportPerIp: { limit: 10, windowSeconds: 60 * 60 },
  /** Prayer report photos: its own budget, so a retry here never spends the journal’s. */
  reportPhotoPerPerson: { limit: 10, windowSeconds: 15 * 60 },
  reportPhotoPerIp: { limit: 60, windowSeconds: 15 * 60 },
  servingRespondPerIp: { limit: 60, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Where the counters live (RATE_LIMIT_STORE). Production uses Upstash Redis: shared by every
 * serverless instance and kept off the database. Development and tests use a fixed-window table
 * in PostgreSQL. Subjects are HMAC'd before they reach either store, so raw phone numbers and IP
 * addresses are never stored.
 */
export interface RateLimitStore {
  hit(executor: Executor, key: string, rule: RateLimitRule, now: Date): Promise<RateLimitResult>;
}

/** Fixed-window counter in the UNLOGGED rate_limit_buckets table. */
export const postgresRateLimitStore: RateLimitStore = {
  async hit(executor, key, rule, now) {
    const windowMs = rule.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const [row] = await queryRows<{ hits: number }>(
      executor,
      sql`INSERT INTO rate_limit_buckets (bucket_key, window_start, hits)
          VALUES (${key}, ${windowStart.toISOString()}::timestamptz, 1)
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
  },
};

/** Maps an Upstash response onto our result. */
export function fromUpstash(response: { success: boolean; remaining: number; reset: number }, rule: RateLimitRule, nowMs: number): RateLimitResult {
  return {
    allowed: response.success,
    hits: response.success ? rule.limit - response.remaining : rule.limit + 1,
    retryAfterSeconds: Math.max(1, Math.ceil((response.reset - nowMs) / 1000)),
  };
}

/** Fixed windows in Upstash Redis, one limiter per rule. */
export function upstashRateLimitStore(redis: Redis): RateLimitStore {
  const limiters = new Map<string, Ratelimit>();
  return {
    async hit(_executor, key, rule) {
      const id = `${rule.limit}-${rule.windowSeconds}`;
      let limiter = limiters.get(id);
      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(rule.limit, `${rule.windowSeconds} s` as `${number} s`),
          prefix: `gentouch:rate:${id}`,
          analytics: false,
        });
        limiters.set(id, limiter);
      }
      const response = await limiter.limit(key);
      await response.pending;
      return fromUpstash(response, rule, Date.now());
    },
  };
}

let store: RateLimitStore | undefined;

function currentStore(): RateLimitStore {
  if (store) return store;
  const env = getEnv();
  store =
    env.RATE_LIMIT_STORE === 'upstash'
      ? upstashRateLimitStore(new Redis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN! }))
      : postgresRateLimitStore;
  return store;
}

/** Test hook. */
export function setRateLimitStore(custom: RateLimitStore | undefined): void {
  store = custom;
}

/** Counts one attempt by `subject` against `rule`. Returns whether it is within the limit. */
export async function hitRateLimit(executor: Executor, subject: string, rule: RateLimitRule, now: Date): Promise<RateLimitResult> {
  return currentStore().hit(executor, hmacHex(subject, 'rate-limit'), rule, now);
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
