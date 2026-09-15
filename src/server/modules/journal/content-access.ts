import { sql } from 'drizzle-orm';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Executor } from '../../db/client';
import type { Sensitivity } from '../../db/enums';
import { grantsFor } from '../../policy/can';
import type { PermissionKey } from '../../policy/catalog';

/**
 * Who may read which journal answers (docs/06 §3, BR-J-11). Status and content are separate:
 * this only governs content. A branch grant reads a tier when the reader is within the tier's
 * distance of the person BOTH on the journal day (snapshot) and today — so a leader who has
 * moved away stops seeing old entries, and a new leader doesn't inherit entries written
 * before they led that person. Global grants read regardless of position.
 */

export const TIER_PERMISSIONS: Record<Sensitivity, PermissionKey> = {
  standard: 'journal.content.view',
  restricted: 'journal.content.restricted.view',
  confidential: 'journal.content.confidential.view',
};

export type ContentAccess = Record<Sensitivity, boolean>;

export interface ContentSubject {
  personId: string;
  /** Snapshot for the journal day: root … direct leader (excluding the person). */
  hierarchyPath: readonly string[];
}

/** Maximum distance in levels at which a branch grant may read each tier. */
export function tierDistanceCaps(contentVisibilityDepth: number): Record<Sensitivity, number> {
  const depth = Math.max(0, Math.floor(contentVisibilityDepth));
  return { standard: depth, restricted: Math.min(1, depth), confidential: 0 };
}

/** Pure evaluation; `currentDepths` maps ancestor id → current closure depth above the person. */
export function evaluateContentAccess(
  ctx: RequestContext,
  subject: ContentSubject,
  contentVisibilityDepth: number,
  currentDepths: ReadonlyMap<string, number>,
): ContentAccess {
  if (ctx.actor.kind !== 'user') return { standard: false, restricted: false, confidential: false };
  if (ctx.actor.personId && ctx.actor.personId === subject.personId) {
    return { standard: true, restricted: true, confidential: true };
  }
  const caps = tierDistanceCaps(contentVisibilityDepth);
  const path = subject.hierarchyPath;

  const allowed = (tier: Sensitivity) =>
    grantsFor(ctx, TIER_PERMISSIONS[tier]).some((grant) => {
      if (grant.scope.type === 'global') return true;
      if (grant.scope.type !== 'branch') return false;
      const limit = Math.min(caps[tier], grant.scope.maxDepth ?? caps[tier]);
      if (limit < 1) return false;
      const anchor = grant.scope.anchorPersonId;
      const index = path.lastIndexOf(anchor);
      const snapshotDistance = index === -1 ? Infinity : path.length - index;
      const currentDistance = currentDepths.get(anchor) ?? Infinity;
      return snapshotDistance <= limit && currentDistance >= 1 && currentDistance <= limit;
    });

  return { standard: allowed('standard'), restricted: allowed('restricted'), confidential: allowed('confidential') };
}

export async function resolveContentAccess(
  executor: Executor,
  ctx: RequestContext,
  subject: ContentSubject,
  contentVisibilityDepth: number,
): Promise<ContentAccess> {
  const anchors = new Set<string>();
  for (const permission of Object.values(TIER_PERMISSIONS)) {
    for (const grant of grantsFor(ctx, permission)) {
      if (grant.scope.type === 'branch') anchors.add(grant.scope.anchorPersonId);
    }
  }
  const depths = new Map<string, number>();
  if (anchors.size > 0) {
    const rows = await queryRows<{ ancestor_id: string; depth: number }>(
      executor,
      sql`SELECT ancestor_id, depth FROM hierarchy_closure
           WHERE descendant_id = ${subject.personId}::uuid
             AND ancestor_id IN (${sql.join([...anchors].map((a) => sql`${a}::uuid`), sql`, `)})`,
    );
    for (const row of rows) depths.set(row.ancestor_id, Number(row.depth));
  }
  return evaluateContentAccess(ctx, subject, contentVisibilityDepth, depths);
}

export const visibleTiers = (access: ContentAccess): Sensitivity[] =>
  (Object.keys(access) as Sensitivity[]).filter((tier) => access[tier]);
