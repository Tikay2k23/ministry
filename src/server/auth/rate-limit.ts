import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { Database } from '../db/client';
import { hitRateLimit, type RateLimitRule } from '../modules/public/rate-limit';

/**
 * Sign-in limits (docs/02 §8.2, docs/07 M5.6). Better Auth's own defaults are 5 requests a minute
 * per IP address, counted in memory, which fails this ministry two ways:
 *
 *  - **Shared connections.** A leaders' onboarding session is a dozen people on one church Wi-Fi
 *    address, and mobile carriers put thousands of subscribers behind one address. The sixth
 *    person to ask for a link, or to open one, was refused. Worse, every allowed request pushed
 *    the window forward, so the count only cleared after a full quiet minute.
 *  - **Serverless instances.** On Vercel each instance kept its own counters, so the limit was
 *    never really enforced anyway.
 *
 * So: the per-IP allowance is raised, the counters move into the store the public endpoints
 * already share (Upstash in production, a Postgres table elsewhere, both fixed-window), and a
 * per-address limit stops the larger IP allowance being used to flood one person's inbox.
 */

/** Per IP address, counted separately for `/sign-in/magic-link` and `/magic-link/verify`. */
export const MAGIC_LINK_PER_IP = { window: 60, max: 30 };

/**
 * Per email address, applied whether or not it has an account, so the answer never reveals which.
 * A leader who is waiting for a link tries two or three times; ten in a quarter of an hour leaves
 * room for that (and for a couple of end-to-end test runs) while bounding what one inbox can be
 * sent to 40 messages an hour.
 */
export const MAGIC_LINK_PER_EMAIL: RateLimitRule = { limit: 10, windowSeconds: 15 * 60 };

/**
 * Better Auth's counters in the app's own rate-limit store, so every serverless instance shares
 * them. The store is fixed-window, so a blocked address is free again at the end of the window
 * rather than after a minute of silence.
 */
export function sharedRateLimitStorage(db: Database) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const result = await hitRateLimit(db, `auth:${key}`, { limit: rule.max, windowSeconds: rule.window }, new Date());
      return { allowed: result.allowed, retryAfter: result.allowed ? null : result.retryAfterSeconds };
    },
  };
}

/**
 * The per-address limit, before the account lookup: an unknown address is counted and answered
 * exactly like a real one, so this can't be used to discover who has an account.
 */
export function magicLinkEmailLimit(db: Database) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/sign-in/magic-link') return;
    const email = typeof (ctx.body as { email?: unknown } | undefined)?.email === 'string' ? (ctx.body as { email: string }).email.trim().toLowerCase() : '';
    if (!email) return;

    const result = await hitRateLimit(db, `magic-link-email:${email}`, MAGIC_LINK_PER_EMAIL, new Date());
    if (!result.allowed) {
      throw new APIError('TOO_MANY_REQUESTS', {
        message: 'We have already sent several sign-in links to that address. Please check your inbox, including spam, and try again in a few minutes.',
        retryAfter: result.retryAfterSeconds,
      });
    }
  });
}
