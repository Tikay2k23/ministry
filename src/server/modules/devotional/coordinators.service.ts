import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { roles, userRoleAssignments, users } from '../../db/schema';
import { notFound, validationError } from '../../errors';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { assignRole, findAccountForPerson, inviteUser, revokeRole } from '../iam/users.service';
import { loadGatheringType } from './common';

/**
 * Worship Coordinators of a gathering type: portal users with the Worship Coordinator role scoped
 * to it. Appointed from the type's setup page, where the type is known (docs/06 role WC).
 */

export async function listWorshipCoordinators(executor: Executor, gatheringTypeId: string) {
  return executor
    .select({ assignmentId: userRoleAssignments.id, userId: users.id, name: users.name, email: users.email, personId: users.personId })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, userRoleAssignments.userId))
    .where(
      and(
        eq(roles.key, 'worship_coordinator'),
        eq(userRoleAssignments.scopeGatheringTypeId, gatheringTypeId),
        isNull(userRoleAssignments.revokedAt),
      ),
    );
}

export const AppointWorshipCoordinatorInput = z.object({
  gatheringTypeId: z.uuid(),
  personId: z.uuid(),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email('Enter a valid email').trim().toLowerCase().optional()),
});

/** Gives a person the Worship Coordinator role for one gathering type, inviting them to the portal if needed. */
export async function appointWorshipCoordinator(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AppointWorshipCoordinatorInput, raw);
  assertGlobal(ctx, 'iam.users.manage');
  const type = await loadGatheringType(db, input.gatheringTypeId);
  if (!type) throw notFound('gathering type');

  const account = await findAccountForPerson(db, input.personId);
  if (account) {
    await assignRole(db, ctx, { userId: account.id, roleKey: 'worship_coordinator', scopeGatheringTypeId: type.id });
    return { invited: false };
  }
  if (!input.email) throw validationError({ email: ['They don’t have a portal account yet. Enter their email to invite them.'] });
  await inviteUser(db, ctx, { personId: input.personId, email: input.email, roleKey: 'worship_coordinator', scopeGatheringTypeId: type.id });
  return { invited: true };
}

export async function removeWorshipCoordinator(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(z.object({ assignmentId: z.uuid() }), raw);
  await revokeRole(db, ctx, { assignmentId, reason: 'No longer coordinating this gathering' });
}
