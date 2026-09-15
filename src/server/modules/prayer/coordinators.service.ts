import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import { roles, userRoleAssignments, users } from '../../db/schema';
import { notFound, validationError } from '../../errors';
import type { ChainRef } from '../../policy/can';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { assignRole, findAccountForPerson, inviteUser, revokeRole } from '../iam/users.service';
import { loadChain } from './common';

/**
 * Who coordinates a chain: portal users holding `prayer.resolve` for it — through the Prayer Chain
 * Coordinator role scoped to the chain, a ministry scope, or (as a fallback) a global grant.
 */

export async function coordinatorUserIds(executor: Executor, chain: ChainRef): Promise<string[]> {
  const rows = await queryRows<{ user_id: string; scope_type: string }>(
    executor,
    sql`SELECT DISTINCT ura.user_id, ura.scope_type
          FROM user_role_assignments ura
          JOIN roles r ON r.id = ura.role_id AND r.archived_at IS NULL
          JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission_key = 'prayer.resolve'
          JOIN users u ON u.id = ura.user_id AND u.status IN ('active', 'invited')
         WHERE ura.revoked_at IS NULL
           AND (ura.expires_at IS NULL OR ura.expires_at > now())
           AND (ura.scope_type = 'global'
                OR (ura.scope_type = 'prayer_chain' AND ura.scope_prayer_chain_id = ${chain.id}::uuid)
                OR (ura.scope_type = 'ministry' AND ura.scope_ministry_id = ${chain.ministryId}::uuid))`,
  );
  const specific = rows.filter((r) => r.scope_type !== 'global');
  return [...new Set((specific.length > 0 ? specific : rows).map((r) => r.user_id))];
}

export async function listChainCoordinators(executor: Executor, chainId: string) {
  return executor
    .select({ assignmentId: userRoleAssignments.id, userId: users.id, name: users.name, email: users.email, personId: users.personId })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, userRoleAssignments.userId))
    .where(
      and(
        eq(roles.key, 'prayer_coordinator'),
        eq(userRoleAssignments.scopePrayerChainId, chainId),
        isNull(userRoleAssignments.revokedAt),
      ),
    );
}

export const AppointCoordinatorInput = z.object({
  chainId: z.uuid(),
  personId: z.uuid(),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email('Enter a valid email').trim().toLowerCase().optional()),
});

/** Gives a person the Prayer Chain Coordinator role for one chain, inviting them to the portal if needed. */
export async function appointCoordinator(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AppointCoordinatorInput, raw);
  assertGlobal(ctx, 'iam.users.manage');
  const chain = await loadChain(db, input.chainId);
  if (!chain) throw notFound('prayer chain');

  const account = await findAccountForPerson(db, input.personId);
  if (account) {
    await assignRole(db, ctx, { userId: account.id, roleKey: 'prayer_coordinator', scopePrayerChainId: chain.id });
    return { invited: false };
  }
  if (!input.email) throw validationError({ email: ['They don’t have a portal account yet. Enter their email to invite them.'] });
  await inviteUser(db, ctx, { personId: input.personId, email: input.email, roleKey: 'prayer_coordinator', scopePrayerChainId: chain.id });
  return { invited: true };
}

export async function removeCoordinator(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(z.object({ assignmentId: z.uuid() }), raw);
  await revokeRole(db, ctx, { assignmentId, reason: 'No longer coordinating this prayer chain' });
}
