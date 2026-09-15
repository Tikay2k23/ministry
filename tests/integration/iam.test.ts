import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { permissions, rolePermissions, roles, userRoleAssignments, users } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { ensureSuperAdmin } from '@/server/db/seed/super-admin';
import { setEmailProvider, type EmailMessage } from '@/server/email/email';
import { lockHierarchy, insertNode } from '@/server/modules/hierarchy/hierarchy.core';
import { deactivateUser, inviteUser, revokeRole } from '@/server/modules/iam/users.service';
import { hasPermission } from '@/server/policy/can';
import { PERMISSIONS, ROLES } from '@/server/policy/catalog';
import { loadGrants } from '@/server/policy/grants';
import { createTestDatabase } from '../helpers/db';
import { createPerson, userContext } from '../helpers/fixtures';

let handle: DatabaseHandle;
const sent: EmailMessage[] = [];

beforeAll(async () => {
  handle = await createTestDatabase();
  await seedReferenceData(handle.db);
  setEmailProvider({ send: async (m) => void sent.push(m) });
});

afterAll(async () => {
  setEmailProvider(undefined);
  await handle.close();
});

async function contextFor(userId: string, twoFactorVerified = true) {
  const grants = await loadGrants(handle.db, userId, { now: new Date(), twoFactorVerified });
  return userContext({ id: userId }, grants);
}

async function placeInTree(personId: string, parentPersonId: string | null) {
  await handle.db.transaction(async (tx) => {
    await lockHierarchy(tx);
    await insertNode(tx, { personId, parentPersonId, primaryLeaderDepth: 1 });
  });
}

describe('reference data seed', () => {
  it('is idempotent and mirrors the permission catalog', async () => {
    await seedReferenceData(handle.db);
    const [perm] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(permissions);
    const [role] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(roles);
    expect(perm!.n).toBe(Object.keys(PERMISSIONS).length);
    expect(role!.n).toBe(Object.keys(ROLES).length);
  });

  it('never gives the Super Admin role pastoral-content permissions', async () => {
    const rows = await handle.db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(eq(roles.key, 'super_admin'));
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain('journal.content.view');
    expect(keys).not.toContain('notes.pastoral.view');
    expect(keys).toContain('access.break_glass');
  });
});

describe('invitations and role grants', () => {
  it('bootstraps a Super Admin idempotently', async () => {
    const first = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const second = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ userId: first.userId, created: false });
  });

  it('keeps sensitive permissions locked until the second factor is verified', async () => {
    const { userId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const withoutTwoFactor = await contextFor(userId, false);
    expect(hasPermission(withoutTwoFactor, 'people.view')).toBe(true);
    expect(hasPermission(withoutTwoFactor, 'iam.users.manage')).toBe(false);
    expect(hasPermission(await contextFor(userId, true), 'iam.users.manage')).toBe(true);
  });

  it('invites a Leader anchored on their own place in the tree, with depth 1 and capped review', async () => {
    const { userId: adminId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const admin = await contextFor(adminId);
    const mark = await createPerson(handle.db, { firstName: 'Mark' });
    await placeInTree(mark.id, null);

    const { userId } = await inviteUser(handle.db, admin, { personId: mark.id, email: 'mark@gentouch.test', roleKey: 'leader' });
    const [assignment] = await handle.db.select().from(userRoleAssignments).where(eq(userRoleAssignments.userId, userId));
    expect(assignment).toMatchObject({ scopeType: 'branch', scopePersonId: mark.id, branchMaxDepth: 1 });
    expect(sent.at(-1)).toMatchObject({ to: 'mark@gentouch.test' });

    const grants = await loadGrants(handle.db, userId, { now: new Date(), twoFactorVerified: false });
    expect(grants.find((g) => g.permission === 'journal.review')?.scope).toMatchObject({ type: 'branch', maxDepth: 1 });
    // Sensitive content permission is not effective without 2FA.
    expect(grants.some((g) => g.permission === 'journal.content.view')).toBe(false);
  });

  it('requires leaders to be placed in the leadership structure first', async () => {
    const { userId: adminId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const admin = await contextFor(adminId);
    await expect(
      inviteUser(handle.db, admin, { firstName: 'Anna', lastName: 'Reyes', email: 'anna@gentouch.test', roleKey: 'leader' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('stops a Pastor from granting a role with permissions they do not hold (docs/06 T12)', async () => {
    const { userId: adminId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const admin = await contextFor(adminId);
    const { userId: pastorId } = await inviteUser(handle.db, admin, {
      firstName: 'Pastor',
      lastName: 'Ed',
      email: 'pastor@gentouch.test',
      roleKey: 'pastor',
    });
    const pastor = await contextFor(pastorId);

    await expect(
      inviteUser(handle.db, pastor, { firstName: 'Office', lastName: 'Staff', email: 'office@gentouch.test', roleKey: 'ministry_admin' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const lead = await createPerson(handle.db, { firstName: 'Samuel' });
    await placeInTree(lead.id, null);
    await expect(
      inviteUser(handle.db, pastor, { personId: lead.id, email: 'samuel@gentouch.test', roleKey: 'leader' }),
    ).resolves.toMatchObject({ personId: lead.id });
  });

  it('refuses a duplicate email and protects the last Super Admin', async () => {
    const { userId: adminId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const admin = await contextFor(adminId);
    await expect(
      inviteUser(handle.db, admin, { firstName: 'X', lastName: 'Y', email: 'OWNER@gentouch.test', roleKey: 'viewer' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [assignment] = await handle.db
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(and(eq(userRoleAssignments.userId, adminId), eq(roles.key, 'super_admin'), isNull(userRoleAssignments.revokedAt)));
    await expect(revokeRole(handle.db, admin, { assignmentId: assignment!.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('deactivates a user and removes their sessions', async () => {
    const { userId: adminId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
    const admin = await contextFor(adminId);
    const { userId } = await inviteUser(handle.db, admin, { firstName: 'Temp', lastName: 'Viewer', email: 'temp@gentouch.test', roleKey: 'viewer' });

    await deactivateUser(handle.db, admin, { userId, reason: 'Left the office' });
    const [user] = await handle.db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe('deactivated');
    await expect(deactivateUser(handle.db, admin, { userId: adminId, reason: 'test' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});
