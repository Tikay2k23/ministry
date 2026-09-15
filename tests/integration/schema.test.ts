import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newPersonCode } from '@/lib/ids';
import { queryRows, type DatabaseHandle } from '@/server/db/client';
import { people, roles, userRoleAssignments, users } from '@/server/db/schema';
import { createTestDatabase } from '../helpers/db';

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

const basePerson = () => ({
  personCode: newPersonCode(),
  firstName: 'Mark',
  lastName: 'Santos',
  source: 'portal' as const,
});

describe('database foundation', () => {
  it('installs the required PostgreSQL extensions', async () => {
    const rows = await queryRows<{ extname: string }>(handle.db, sql`SELECT extname FROM pg_extension`);
    expect(rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(['btree_gin', 'btree_gist', 'citext', 'pg_trgm', 'unaccent']),
    );
  });

  it('generates an accent-insensitive, lower-case search name', async () => {
    const [row] = await handle.db
      .insert(people)
      .values({ ...basePerson(), firstName: 'José', lastName: 'Peña' })
      .returning();
    expect(row?.searchName).toContain('jose');
    expect(row?.searchName).toContain('pena');
  });

  it('finds people by trigram similarity', async () => {
    const rows = await queryRows<{ first_name: string }>(
      handle.db,
      sql`SELECT first_name FROM people WHERE search_name % ${'pena jose'}`,
    );
    expect(rows.map((r) => r.first_name)).toContain('José');
  });

  it('rejects malformed person codes and phone numbers', async () => {
    await expect(
      handle.db.insert(people).values({ ...basePerson(), personCode: 'P-OOOOOO' }),
    ).rejects.toThrow();
    await expect(
      handle.db.insert(people).values({ ...basePerson(), phoneE164: '09171234567' }),
    ).rejects.toThrow();
  });

  it('enforces archive consistency (reason required with archived_at)', async () => {
    await expect(
      handle.db.insert(people).values({ ...basePerson(), archivedAt: new Date() }),
    ).rejects.toThrow();
  });

  it('allows only one active global assignment of the same role per user', async () => {
    const [role] = await handle.db
      .insert(roles)
      .values({ key: 'test_role', name: 'Test role', defaultScopeType: 'global' })
      .returning();
    const [user] = await handle.db
      .insert(users)
      .values({ email: 'Leader@Example.org', name: 'Leader' })
      .returning();
    const grant = { userId: user!.id, roleId: role!.id, scopeType: 'global' as const };

    await handle.db.insert(userRoleAssignments).values(grant);
    await expect(handle.db.insert(userRoleAssignments).values(grant)).rejects.toThrow();
  });

  it('treats emails case-insensitively (citext)', async () => {
    await expect(
      handle.db.insert(users).values({ email: 'leader@example.org', name: 'Duplicate' }),
    ).rejects.toThrow();
  });
});
