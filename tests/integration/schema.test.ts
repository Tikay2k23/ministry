import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newPersonCode } from '@/lib/ids';
import { openDatabase, queryRows, type DatabaseHandle } from '@/server/db/client';
import { pendingMigrations } from '@/server/db/migrate';
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
  it('knows which migrations a database is missing (the development startup warning)', async () => {
    expect(await pendingMigrations(handle.db)).toEqual([]);

    const empty = openDatabase('pglite://memory');
    try {
      const pending = await pendingMigrations(empty.db);
      expect(pending[0]).toBe('0000_extensions');
      expect(pending).toContain('0008_devotional');
    } finally {
      await empty.close();
    }
  });

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

describe('row-level security (migration 0007)', () => {
  beforeAll(async () => {
    await handle.db.execute(sql`CREATE ROLE rls_outsider NOLOGIN`);
    await handle.db.execute(sql`GRANT SELECT ON people, audit_logs TO rls_outsider`);
    await handle.db.execute(sql`CREATE ROLE rls_app_login NOLOGIN IN ROLE gentouch_app`);
    await handle.db.insert(people).values(basePerson());
  });

  const runAs = (role: 'rls_outsider' | 'rls_app_login', statement: SQL) =>
    handle.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
      return queryRows<Record<string, unknown>>(tx, statement);
    });

  const errorCode = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string; cause?: { code?: string } }) => error.cause?.code ?? error.code ?? 'unknown',
    );

  it('enables RLS on every table, each with a policy for the application role', async () => {
    const tables = await queryRows<{ table_name: string; rls: boolean; app_policy: boolean }>(
      handle.db,
      sql`SELECT c.relname AS table_name, c.relrowsecurity AS rls,
                 EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'gentouch_app_full_access') AS app_policy
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    expect(tables.length).toBeGreaterThan(50);
    // A new table needs both in its migration — see the note at the top of drizzle/0007_row_level_security.sql.
    expect(tables.filter((t) => !t.rls || !t.app_policy).map((t) => t.table_name)).toEqual([]);
  });

  it('shows no rows to a role without a policy, even with table privileges', async () => {
    expect(await runAs('rls_outsider', sql`SELECT id FROM people`)).toEqual([]);
  });

  it('lets members of the application role work normally', async () => {
    expect((await runAs('rls_app_login', sql`SELECT id FROM people`)).length).toBeGreaterThan(0);
  });

  it('keeps audit entries insert-only for the application role', async () => {
    expect(await errorCode(runAs('rls_app_login', sql`UPDATE audit_logs SET action = action`))).toBe('42501');
    expect(await errorCode(runAs('rls_app_login', sql`DELETE FROM audit_logs`))).toBe('42501');
  });
});
