import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../../crypto';
import type { Executor } from '../../db/client';
import { actionTokens, prayerAssignments } from '../../db/schema';
import { getEnv } from '../../env';

/**
 * Personal action links for one prayer assignment (`/a/{token}`, docs/02 §5). Secret, stored only
 * as a SHA-256 hash, bound to the person and the assignment, and valid until a week after the
 * slot (so a late "I've finished" and the optional report still work). A new link doesn't revoke
 * earlier ones — a reminder email and a link shared by the coordinator can both be in use — but
 * all of them are revoked when the assignment is replaced or cancelled.
 */

const LINK_VALID_AFTER_SLOT_MS = 7 * 86_400_000;
const INACTIVE = ['replaced', 'cancelled', 'missed', 'excused'];

export async function issuePrayerActionLink(
  executor: Executor,
  assignmentId: string,
  now: Date,
  createdBy: string | null = null,
): Promise<{ url: string; expiresAt: Date } | null> {
  const [assignment] = await executor
    .select({ id: prayerAssignments.id, personId: prayerAssignments.personId, status: prayerAssignments.status, endsAt: prayerAssignments.endsAt })
    .from(prayerAssignments)
    .where(eq(prayerAssignments.id, assignmentId));
  if (!assignment || INACTIVE.includes(assignment.status)) return null;

  const expiresAt = new Date(assignment.endsAt.getTime() + LINK_VALID_AFTER_SLOT_MS);
  if (expiresAt <= now) return null;

  const token = randomToken(32);
  await executor.insert(actionTokens).values({
    tokenHash: sha256Hex(token),
    purpose: 'prayer_assignment',
    personId: assignment.personId,
    subjectId: assignment.id,
    expiresAt,
    maxUses: 100,
    createdBy,
  });
  return { url: `${getEnv().APP_URL}/a/${token}`, expiresAt };
}

export interface PrayerTokenIdentity {
  tokenId: string;
  assignmentId: string;
  personId: string;
}

export async function resolvePrayerActionToken(executor: Executor, token: string, now: Date): Promise<PrayerTokenIdentity | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const [row] = await executor
    .select({ id: actionTokens.id, subjectId: actionTokens.subjectId, personId: actionTokens.personId })
    .from(actionTokens)
    .where(
      and(
        eq(actionTokens.tokenHash, sha256Hex(token)),
        eq(actionTokens.purpose, 'prayer_assignment'),
        isNull(actionTokens.revokedAt),
        gt(actionTokens.expiresAt, now),
        lt(actionTokens.useCount, actionTokens.maxUses),
      ),
    );
  return row?.subjectId ? { tokenId: row.id, assignmentId: row.subjectId, personId: row.personId } : null;
}

export async function recordPrayerTokenUse(executor: Executor, tokenId: string, now: Date) {
  await executor
    .update(actionTokens)
    .set({ useCount: sql`${actionTokens.useCount} + 1`, lastUsedAt: now })
    .where(eq(actionTokens.id, tokenId));
}

export async function revokeAssignmentLinks(executor: Executor, assignmentId: string, now: Date) {
  await executor
    .update(actionTokens)
    .set({ revokedAt: now })
    .where(and(eq(actionTokens.subjectId, assignmentId), eq(actionTokens.purpose, 'prayer_assignment'), isNull(actionTokens.revokedAt)));
}
