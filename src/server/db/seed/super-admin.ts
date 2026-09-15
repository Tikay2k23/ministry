import { and, eq, isNull } from 'drizzle-orm';
import { newPersonCode } from '@/lib/ids';
import { systemContext } from '../../context/request-context';
import { recordAudit } from '../../modules/audit/audit.service';
import type { Database } from '../client';
import { people, roles, userRoleAssignments, users } from '../schema';

/**
 * Bootstraps the first Super Admin (idempotent). The account starts as `invited`;
 * signing in with a magic link activates it. Sensitive permissions stay locked until
 * the admin enables two-factor authentication (docs/02 §3).
 */
export async function ensureSuperAdmin(
  db: Database,
  input: { email: string; firstName: string; lastName: string },
): Promise<{ userId: string; created: boolean }> {
  const ctx = systemContext('seed');
  return db.transaction(async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'super_admin'));
    if (!role) throw new Error('Run seedReferenceData before ensureSuperAdmin.');

    let [user] = await tx.select().from(users).where(eq(users.email, input.email));
    let created = false;
    if (!user) {
      const [person] = await tx
        .insert(people)
        .values({
          personCode: newPersonCode(),
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          source: 'portal',
          journalExpected: false,
        })
        .returning();
      [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: `${input.firstName} ${input.lastName}`,
          personId: person!.id,
          status: 'invited',
        })
        .returning();
      created = true;
    }

    const [existing] = await tx
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.userId, user!.id),
          eq(userRoleAssignments.roleId, role.id),
          eq(userRoleAssignments.scopeType, 'global'),
          isNull(userRoleAssignments.revokedAt),
        ),
      );
    if (!existing) {
      await tx.insert(userRoleAssignments).values({
        userId: user!.id,
        roleId: role.id,
        scopeType: 'global',
        grantReason: 'Initial Super Admin (seed)',
      });
      await recordAudit(tx, ctx, {
        category: 'security',
        action: 'iam.role_granted',
        entityType: 'user',
        entityId: user!.id,
        newValues: { role: 'super_admin', scope: 'global' },
        reason: 'Initial Super Admin (seed)',
      });
    }
    return { userId: user!.id, created };
  });
}
