import { and, asc, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { newPersonCode } from '@/lib/ids';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor, Transaction } from '../../db/client';
import type { ScopeType } from '../../db/enums';
import { isUniqueViolation } from '../../db/errors';
import { gatheringTypes, ministries, people, prayerChains, roles, teams, userRoleAssignments, users, authSessions } from '../../db/schema';
import { getEmailProvider } from '../../email/email';
import { invitationEmail } from '../../email/templates';
import { getEnv } from '../../env';
import { conflict, forbidden, invalidState, notFound, validationError } from '../../errors';
import { assertGlobal, hasGlobal, hasPermission } from '../../policy/can';
import { bundleEntryKey, isPastoral, isSensitive, ROLES, type RoleDefinition, type RoleKey } from '../../policy/catalog';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { getNode } from '../hierarchy/hierarchy.core';
import { getSetting } from '../settings/settings.service';

/**
 * Portal accounts and role assignments (docs/02a §3.1, docs/06 principle 7).
 * Only people with global `iam.users.manage` may invite or grant; nobody may grant a role
 * containing *sensitive* permissions they don't hold themselves — except holders of
 * `iam.roles.manage` (Super Admin), whose grants of pastoral permissions are flagged in the audit log.
 */

const ROLE_KEYS = Object.keys(ROLES) as [RoleKey, ...RoleKey[]];

const RoleGrantFields = {
  roleKey: z.enum(ROLE_KEYS),
  /** Branch anchor; defaults to the invitee's own person. */
  scopePersonId: z.uuid().optional(),
  scopeMinistryId: z.uuid().optional(),
  scopeTeamId: z.uuid().optional(),
  scopePrayerChainId: z.uuid().optional(),
  scopeGatheringTypeId: z.uuid().optional(),
  /** Branch roles: override the default depth (null = whole downline). */
  branchMaxDepth: z.int().min(1).max(50).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
};

export const InviteUserInput = z
  .object({
    personId: z.uuid().optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    email: z.email().trim().toLowerCase(),
    ...RoleGrantFields,
  })
  .refine((v) => v.personId || (v.firstName && v.lastName), {
    path: ['firstName'],
    message: 'Choose an existing person or enter their first and last name.',
  });

export const AssignRoleInput = z.object({ userId: z.uuid(), ...RoleGrantFields });

type GrantRequest = z.infer<z.ZodObject<typeof RoleGrantFields>> & { userId: string; personId: string | null };

async function grantRoleInTx(tx: Transaction, ctx: RequestContext, request: GrantRequest): Promise<string> {
  const definition: RoleDefinition = ROLES[request.roleKey];
  const permissionKeys = definition.permissions.map(bundleEntryKey);

  // Privilege-escalation guard (docs/06 principle 7): you can't grant *sensitive* access you
  // don't hold yourself. Super Admins (iam.roles.manage) are exempt; their pastoral grants are flagged.
  if (!hasPermission(ctx, 'iam.roles.manage')) {
    const missing = permissionKeys.filter((p) => isSensitive(p) && !hasPermission(ctx, p));
    if (missing.length > 0) {
      throw forbidden(`You can't grant the ${definition.name} role because it includes access you don't have.`);
    }
  }

  const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.key, request.roleKey), isNull(roles.archivedAt)));
  if (!role) throw notFound('role');

  const scope: Partial<typeof userRoleAssignments.$inferInsert> = { scopeType: definition.defaultScopeType };
  switch (definition.defaultScopeType) {
    case 'branch': {
      const anchor = request.scopePersonId ?? request.personId;
      if (!anchor || !(await getNode(tx, anchor))) {
        throw validationError({ roleKey: ['Place this person in the leadership structure before giving them a leader role.'] });
      }
      const { leaderStatusDepth } = await getSetting(tx, 'hierarchy');
      const roleDefault = definition.defaultBranchDepth ?? null;
      scope.scopePersonId = anchor;
      scope.branchMaxDepth =
        request.branchMaxDepth !== undefined ? request.branchMaxDepth : request.roleKey === 'leader' ? leaderStatusDepth : roleDefault;
      break;
    }
    case 'ministry': {
      if (!request.scopeMinistryId) throw validationError({ scopeMinistryId: ['Choose the ministry.'] });
      const [m] = await tx.select({ id: ministries.id }).from(ministries).where(eq(ministries.id, request.scopeMinistryId));
      if (!m) throw validationError({ scopeMinistryId: ['That ministry does not exist.'] });
      scope.scopeMinistryId = request.scopeMinistryId;
      break;
    }
    case 'team': {
      if (!request.scopeTeamId) throw validationError({ scopeTeamId: ['Choose the team.'] });
      const [t] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, request.scopeTeamId));
      if (!t) throw validationError({ scopeTeamId: ['That team does not exist.'] });
      scope.scopeTeamId = request.scopeTeamId;
      break;
    }
    case 'prayer_chain': {
      if (!request.scopePrayerChainId) throw validationError({ scopePrayerChainId: ['Choose the prayer chain.'] });
      const [c] = await tx
        .select({ id: prayerChains.id })
        .from(prayerChains)
        .where(and(eq(prayerChains.id, request.scopePrayerChainId), isNull(prayerChains.archivedAt)));
      if (!c) throw validationError({ scopePrayerChainId: ['That prayer chain does not exist.'] });
      scope.scopePrayerChainId = request.scopePrayerChainId;
      break;
    }
    case 'gathering_type': {
      if (!request.scopeGatheringTypeId) throw validationError({ scopeGatheringTypeId: ['Choose the gathering type.'] });
      const [type] = await tx.select({ id: gatheringTypes.id }).from(gatheringTypes).where(eq(gatheringTypes.id, request.scopeGatheringTypeId));
      if (!type) throw validationError({ scopeGatheringTypeId: ['That gathering type does not exist.'] });
      scope.scopeGatheringTypeId = request.scopeGatheringTypeId;
      break;
    }
    case 'global':
      break;
  }

  let assignmentId: string;
  try {
    const [row] = await tx
      .insert(userRoleAssignments)
      .values({
        userId: request.userId,
        roleId: role.id,
        grantedBy: actorUserId(ctx),
        grantedAt: ctx.now,
        grantReason: request.reason ?? null,
        ...scope,
      } as typeof userRoleAssignments.$inferInsert)
      .returning({ id: userRoleAssignments.id });
    assignmentId = row!.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('This person already has that role.');
    throw error;
  }

  const pastoral = permissionKeys.some(isPastoral);
  await recordAudit(tx, ctx, {
    category: 'security',
    action: 'iam.role_granted',
    entityType: 'user',
    entityId: request.userId,
    summary: pastoral ? `Granted ${definition.name} (includes pastoral-content access)` : `Granted ${definition.name}`,
    newValues: { role: request.roleKey, ...scope, pastoral },
    reason: request.reason ?? null,
  });
  // TODO(M2 notifications): notify all Pastors when `pastoral` is true (docs/06 note i).
  return assignmentId;
}

export async function inviteUser(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(InviteUserInput, raw);
  assertGlobal(ctx, 'iam.users.manage');

  const result = await db.transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existingUser) throw conflict('A portal account already uses this email address.');

    let person: { id: string; firstName: string; lastName: string };
    if (input.personId) {
      const [found] = await tx
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(and(eq(people.id, input.personId), isNull(people.archivedAt)));
      if (!found) throw notFound('person');
      const [linked] = await tx.select({ id: users.id }).from(users).where(eq(users.personId, found.id));
      if (linked) throw conflict('This person already has a portal account.');
      person = found;
    } else {
      const [created] = await tx
        .insert(people)
        .values({
          personCode: newPersonCode(),
          firstName: input.firstName!,
          lastName: input.lastName!,
          email: input.email,
          source: 'portal',
          createdBy: actorUserId(ctx),
        })
        .returning({ id: people.id, firstName: people.firstName, lastName: people.lastName });
      person = created!;
    }

    const [user] = await tx
      .insert(users)
      .values({ email: input.email, name: `${person.firstName} ${person.lastName}`, personId: person.id, status: 'invited' })
      .returning({ id: users.id });

    await grantRoleInTx(tx, ctx, { ...input, userId: user!.id, personId: person.id });
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'iam.user_invited',
      entityType: 'user',
      entityId: user!.id,
      newValues: { email: input.email, personId: person.id, role: input.roleKey },
    });
    return { userId: user!.id, personId: person.id };
  });

  const inviter = ctx.actor.kind === 'user' ? ctx.actor.name : 'The ministry office';
  await getEmailProvider().send(invitationEmail(input.email, inviter, `${getEnv().APP_URL}/sign-in`));
  return result;
}

export async function assignRole(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AssignRoleInput, raw);
  assertGlobal(ctx, 'iam.users.manage');
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, personId: users.personId }).from(users).where(eq(users.id, input.userId));
    if (!user) throw notFound('user');
    return { assignmentId: await grantRoleInTx(tx, ctx, { ...input, personId: user.personId }) };
  });
}

async function activeSuperAdminCount(tx: Transaction, excludingUserId?: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, userRoleAssignments.userId))
    .where(
      and(
        eq(roles.key, 'super_admin'),
        isNull(userRoleAssignments.revokedAt),
        inArray(users.status, ['invited', 'active']),
        excludingUserId ? ne(users.id, excludingUserId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export const RevokeRoleInput = z.object({ assignmentId: z.uuid(), reason: z.string().trim().max(500).optional() });

export async function revokeRole(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(RevokeRoleInput, raw);
  assertGlobal(ctx, 'iam.users.manage');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: userRoleAssignments.id, userId: userRoleAssignments.userId, revokedAt: userRoleAssignments.revokedAt, roleKey: roles.key })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(eq(userRoleAssignments.id, input.assignmentId));
    if (!row) throw notFound('role assignment');
    if (row.revokedAt) throw invalidState('This role was already removed.');
    if (row.roleKey === 'super_admin' && (await activeSuperAdminCount(tx, row.userId)) === 0) {
      throw invalidState('You can’t remove the last Super Admin.');
    }
    await tx
      .update(userRoleAssignments)
      .set({ revokedAt: ctx.now, revokedBy: actorUserId(ctx) })
      .where(eq(userRoleAssignments.id, row.id));
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'iam.role_revoked',
      entityType: 'user',
      entityId: row.userId,
      oldValues: { role: row.roleKey },
      reason: input.reason ?? null,
    });
  });
}

export const DeactivateUserInput = z.object({ userId: z.uuid(), reason: z.string().trim().min(1).max(500) });

export async function deactivateUser(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(DeactivateUserInput, raw);
  assertGlobal(ctx, 'iam.users.manage');
  if (input.userId === actorUserId(ctx)) throw invalidState('You can’t deactivate your own account.');
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, input.userId));
    if (!user) throw notFound('user');
    if (user.status === 'deactivated') throw invalidState('This account is already deactivated.');
    if ((await activeSuperAdminCount(tx, input.userId)) === 0 && (await activeSuperAdminCount(tx)) > 0) {
      // The user being deactivated is the last active Super Admin.
      throw invalidState('You can’t deactivate the last Super Admin.');
    }
    await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now }).where(eq(users.id, input.userId));
    await tx.delete(authSessions).where(eq(authSessions.userId, input.userId)); // sign out everywhere, now
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'iam.user_deactivated',
      entityType: 'user',
      entityId: input.userId,
      oldValues: { status: user.status },
      newValues: { status: 'deactivated' },
      reason: input.reason,
    });
  });
}

/**
 * Global-scope roles the actor may grant from the invitation form. Branch roles (Leader,
 * Primary Leader) and ministry roles are granted from a person's profile (M1), where the
 * scope can be chosen.
 */
export function grantableGlobalRoles(ctx: RequestContext): { key: RoleKey; name: string; description: string }[] {
  const canGrantAnything = hasPermission(ctx, 'iam.roles.manage');
  return (Object.entries(ROLES) as [RoleKey, RoleDefinition][])
    .filter(([, def]) => def.defaultScopeType === 'global')
    .filter(
      ([, def]) =>
        canGrantAnything ||
        def.permissions.map(bundleEntryKey).every((p) => !isSensitive(p) || hasPermission(ctx, p)),
    )
    .map(([key, def]) => ({ key, name: def.name, description: def.description }));
}

export interface GrantableRole {
  key: RoleKey;
  name: string;
  description: string;
  scopeType: ScopeType;
  available: boolean;
  unavailableReason: string | null;
}

/** Roles the actor may give this person from their profile, with scope requirements. */
export async function grantableRolesForPerson(
  db: Executor,
  ctx: RequestContext,
  personId: string,
): Promise<{ roles: GrantableRole[]; ministries: { id: string; name: string }[] }> {
  if (!hasGlobal(ctx, 'iam.users.manage')) return { roles: [], ministries: [] };
  const placed = Boolean(await getNode(db, personId));
  const canGrantAnything = hasPermission(ctx, 'iam.roles.manage');

  const roleOptions = (Object.entries(ROLES) as [RoleKey, RoleDefinition][])
    // Chain and worship coordinators are appointed from the prayer chain's or the gathering type's
    // setup page, where the chain or type is known.
    .filter(([, def]) => def.defaultScopeType !== 'prayer_chain' && def.defaultScopeType !== 'gathering_type')
    .filter(
      ([, def]) =>
        canGrantAnything || def.permissions.map(bundleEntryKey).every((p) => !isSensitive(p) || hasPermission(ctx, p)),
    )
    .map(([key, def]) => ({
      key,
      name: def.name,
      description: def.description,
      scopeType: def.defaultScopeType,
      available: def.defaultScopeType !== 'branch' || placed,
      unavailableReason:
        def.defaultScopeType === 'branch' && !placed ? 'Place this person in the leadership structure first' : null,
    }));

  const ministryOptions = await db
    .select({ id: ministries.id, name: ministries.name })
    .from(ministries)
    .where(isNull(ministries.archivedAt))
    .orderBy(asc(ministries.name));
  return { roles: roleOptions, ministries: ministryOptions };
}

export async function findAccountForPerson(db: Executor, personId: string) {
  const [row] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.personId, personId));
  return row ?? null;
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  roles: { assignmentId: string; roleKey: string; roleName: string; scopeType: string; branchMaxDepth: number | null }[];
}

export async function listUsers(db: Database, ctx: RequestContext): Promise<UserListItem[]> {
  assertGlobal(ctx, 'iam.users.view');
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      twoFactorEnabled: users.twoFactorEnabled,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.name));
  if (rows.length === 0) return [];

  const assignments = await db
    .select({
      userId: userRoleAssignments.userId,
      assignmentId: userRoleAssignments.id,
      roleKey: roles.key,
      roleName: roles.name,
      scopeType: userRoleAssignments.scopeType,
      branchMaxDepth: userRoleAssignments.branchMaxDepth,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(and(isNull(userRoleAssignments.revokedAt), inArray(userRoleAssignments.userId, rows.map((r) => r.id))));

  const byUser = new Map<string, UserListItem['roles']>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push({ assignmentId: a.assignmentId, roleKey: a.roleKey, roleName: a.roleName, scopeType: a.scopeType, branchMaxDepth: a.branchMaxDepth });
    byUser.set(a.userId, list);
  }
  return rows.map((r) => ({ ...r, roles: byUser.get(r.id) ?? [] }));
}
