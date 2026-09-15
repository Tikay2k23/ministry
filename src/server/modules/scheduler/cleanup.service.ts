import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { actionTokens, participantKeys, rateLimitBuckets } from '../../db/schema';

/** Daily housekeeping (docs/02 §7 `tokens.cleanup`): expired secrets and old rate-limit windows. */
export async function cleanupExpiredRecords(db: Database, now: Date) {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const tokens = await db
    .delete(actionTokens)
    .where(or(lt(actionTokens.expiresAt, monthAgo), and(isNotNull(actionTokens.revokedAt), lt(actionTokens.revokedAt, monthAgo))))
    .returning({ id: actionTokens.id });
  const keys = await db
    .delete(participantKeys)
    .where(or(lt(participantKeys.expiresAt, monthAgo), and(isNotNull(participantKeys.revokedAt), lt(participantKeys.revokedAt, monthAgo))))
    .returning({ id: participantKeys.id });
  const buckets = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStart, dayAgo))
    .returning({ key: rateLimitBuckets.bucketKey });

  return { actionTokens: tokens.length, participantKeys: keys.length, rateLimitBuckets: buckets.length };
}
