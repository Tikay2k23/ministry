import { randomUUID } from 'node:crypto';
import { newPersonCode } from '@/lib/ids';
import type { RequestContext } from '@/server/context/request-context';
import type { Database } from '@/server/db/client';
import { people, users } from '@/server/db/schema';
import type { PermissionKey } from '@/server/policy/catalog';
import type { Grant } from '@/server/policy/grants';

let counter = 0;

export async function createPerson(
  db: Database,
  overrides: Partial<typeof people.$inferInsert> = {},
): Promise<typeof people.$inferSelect> {
  counter += 1;
  const [row] = await db
    .insert(people)
    .values({
      personCode: newPersonCode(),
      firstName: 'Person',
      lastName: `Number${counter}`,
      source: 'portal',
      ...overrides,
    })
    .returning();
  return row!;
}

export async function createUser(
  db: Database,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `user${counter}-${randomUUID().slice(0, 8)}@test.local`, name: `User ${counter}`, status: 'active', ...overrides })
    .returning();
  return row!;
}

export function userContext(
  user: { id: string; personId?: string | null },
  grants: Grant[],
  now: Date = new Date('2026-09-12T08:00:00Z'),
): RequestContext {
  return {
    requestId: randomUUID(),
    now,
    actor: {
      kind: 'user',
      userId: user.id,
      personId: user.personId ?? null,
      name: 'Test user',
      email: 'test@test.local',
      grants,
      twoFactorVerified: true,
    },
  };
}

export const globalGrant = (permission: PermissionKey): Grant => ({
  permission,
  scope: { type: 'global' },
  roleKey: 'test',
});

export const branchGrant = (permission: PermissionKey, anchorPersonId: string, maxDepth: number | null = null): Grant => ({
  permission,
  scope: { type: 'branch', anchorPersonId, maxDepth },
  roleKey: 'test',
});
