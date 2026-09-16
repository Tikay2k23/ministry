import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../../crypto';
import type { Executor } from '../../db/client';
import { actionTokens, gatheringAssignments, gatherings } from '../../db/schema';
import { getEnv } from '../../env';

/**
 * Personal serving links (`/a/{token}`, docs/05 W8 step 6 and W9). Secret, stored only as a SHA-256
 * hash, bound to the person and the assignment, and valid until the gathering ends. A new link
 * doesn't revoke earlier ones — an email and a link the coordinator shared can both be in use —
 * but all of them are revoked when the assignment is replaced or removed, or the gathering cancelled.
 */

const RESPONDABLE = ['pending', 'confirmed', 'declined'];

export async function issueServingActionLink(
  executor: Executor,
  assignmentId: string,
  now: Date,
  createdBy: string | null = null,
): Promise<{ url: string; expiresAt: Date } | null> {
  const [row] = await executor
    .select({ personId: gatheringAssignments.personId, status: gatheringAssignments.status, endsAt: gatherings.endsAt, gatheringStatus: gatherings.status })
    .from(gatheringAssignments)
    .innerJoin(gatherings, eq(gatherings.id, gatheringAssignments.gatheringId))
    .where(eq(gatheringAssignments.id, assignmentId));
  if (!row || !RESPONDABLE.includes(row.status) || row.gatheringStatus !== 'scheduled' || row.endsAt <= now) return null;

  const token = randomToken(32);
  await executor.insert(actionTokens).values({
    tokenHash: sha256Hex(token),
    purpose: 'gathering_assignment',
    personId: row.personId,
    subjectId: assignmentId,
    expiresAt: row.endsAt,
    maxUses: 100,
    createdBy,
  });
  return { url: `${getEnv().APP_URL}/a/${token}`, expiresAt: row.endsAt };
}

export type ServingLink =
  | { kind: 'invalid' }
  | { kind: 'active' | 'revoked'; tokenId: string; assignmentId: string; personId: string };

/** Looks a link up without using it. Expired or unknown links are invalid; revoked ones say why. */
export async function inspectServingLink(executor: Executor, token: string, now: Date): Promise<ServingLink> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return { kind: 'invalid' };
  const [row] = await executor
    .select({
      id: actionTokens.id,
      subjectId: actionTokens.subjectId,
      personId: actionTokens.personId,
      revokedAt: actionTokens.revokedAt,
      expiresAt: actionTokens.expiresAt,
      useCount: actionTokens.useCount,
      maxUses: actionTokens.maxUses,
    })
    .from(actionTokens)
    .where(and(eq(actionTokens.tokenHash, sha256Hex(token)), eq(actionTokens.purpose, 'gathering_assignment')));
  if (!row?.subjectId || row.expiresAt <= now || row.useCount >= row.maxUses) return { kind: 'invalid' };
  return { kind: row.revokedAt ? 'revoked' : 'active', tokenId: row.id, assignmentId: row.subjectId, personId: row.personId };
}

export async function recordServingTokenUse(executor: Executor, tokenId: string, now: Date) {
  await executor
    .update(actionTokens)
    .set({ useCount: sql`${actionTokens.useCount} + 1`, lastUsedAt: now })
    .where(eq(actionTokens.id, tokenId));
}

export async function revokeServingLinks(executor: Executor, assignmentIds: string[], now: Date) {
  if (assignmentIds.length === 0) return;
  await executor
    .update(actionTokens)
    .set({ revokedAt: now })
    .where(and(eq(actionTokens.purpose, 'gathering_assignment'), inArray(actionTokens.subjectId, assignmentIds), isNull(actionTokens.revokedAt)));
}

/** Which kind of personal link this is, so `/a/{token}` can show the right page. */
export async function actionLinkPurpose(executor: Executor, token: string): Promise<'prayer_assignment' | 'gathering_assignment' | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const [row] = await executor
    .select({ purpose: actionTokens.purpose })
    .from(actionTokens)
    .where(eq(actionTokens.tokenHash, sha256Hex(token)));
  return row?.purpose === 'prayer_assignment' || row?.purpose === 'gathering_assignment' ? row.purpose : null;
}
