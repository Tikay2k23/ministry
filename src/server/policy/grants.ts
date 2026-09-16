import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { rolePermissions, roles, userRoleAssignments } from '../db/schema';
import { isSensitive, PERMISSIONS, type PermissionKey } from './catalog';

export type Scope =
  | { type: 'global' }
  /** Anchor person + downline to `maxDepth` levels (null = unlimited). Depth 0 = the anchor. */
  | { type: 'branch'; anchorPersonId: string; maxDepth: number | null }
  | { type: 'ministry'; ministryId: string }
  | { type: 'team'; teamId: string }
  /** A prayer chain and, for people-based permissions, that chain's participants. */
  | { type: 'prayer_chain'; chainId: string }
  /** A devotional gathering type and, for people-based permissions, the people who serve in it. */
  | { type: 'gathering_type'; gatheringTypeId: string };

export interface Grant {
  permission: PermissionKey;
  scope: Scope;
  roleKey: string;
}

function minDepth(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Resolves a user's effective grants from active, unexpired role assignments.
 * Loaded per request and never cached across requests, so revocations apply immediately
 * (docs/06 test T17). Sensitive permissions are dropped unless 2FA is enabled.
 */
export async function loadGrants(
  executor: Executor,
  userId: string,
  options: { now: Date; twoFactorVerified: boolean },
): Promise<Grant[]> {
  const rows = await executor
    .select({
      roleKey: roles.key,
      permission: rolePermissions.permissionKey,
      depthCap: rolePermissions.branchDepthCap,
      scopeType: userRoleAssignments.scopeType,
      scopePersonId: userRoleAssignments.scopePersonId,
      scopeMinistryId: userRoleAssignments.scopeMinistryId,
      scopeTeamId: userRoleAssignments.scopeTeamId,
      scopePrayerChainId: userRoleAssignments.scopePrayerChainId,
      scopeGatheringTypeId: userRoleAssignments.scopeGatheringTypeId,
      branchMaxDepth: userRoleAssignments.branchMaxDepth,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(userRoleAssignments.userId, userId),
        isNull(userRoleAssignments.revokedAt),
        isNull(roles.archivedAt),
        or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, options.now)),
      ),
    );

  const grants: Grant[] = [];
  for (const row of rows) {
    if (!(row.permission in PERMISSIONS)) continue; // retired permission still in DB
    const permission = row.permission as PermissionKey;
    if (isSensitive(permission) && !options.twoFactorVerified) continue;

    let scope: Scope | null = null;
    if (row.scopeType === 'global') scope = { type: 'global' };
    else if (row.scopeType === 'branch' && row.scopePersonId)
      scope = {
        type: 'branch',
        anchorPersonId: row.scopePersonId,
        maxDepth: minDepth(row.branchMaxDepth, row.depthCap),
      };
    else if (row.scopeType === 'ministry' && row.scopeMinistryId)
      scope = { type: 'ministry', ministryId: row.scopeMinistryId };
    else if (row.scopeType === 'team' && row.scopeTeamId) scope = { type: 'team', teamId: row.scopeTeamId };
    else if (row.scopeType === 'prayer_chain' && row.scopePrayerChainId)
      scope = { type: 'prayer_chain', chainId: row.scopePrayerChainId };
    else if (row.scopeType === 'gathering_type' && row.scopeGatheringTypeId)
      scope = { type: 'gathering_type', gatheringTypeId: row.scopeGatheringTypeId };

    if (scope) grants.push({ permission, scope, roleKey: row.roleKey });
  }
  return grants;
}
