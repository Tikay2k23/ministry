import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { queryRows, type Database, type DatabaseHandle, type Schema } from './client';

const DEFAULT_MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

/** Applies every pending SQL migration in ./drizzle, in order, inside drizzle's migration table. */
export async function runMigrations(handle: DatabaseHandle, migrationsFolder = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  if (handle.kind === 'pglite') {
    await migratePglite(handle.db as unknown as PgliteDatabase<Schema>, { migrationsFolder });
  } else {
    await migrateNodePg(handle.db as unknown as NodePgDatabase<Schema>, { migrationsFolder });
  }
}

/**
 * The migrations in ./drizzle that the database hasn't applied yet, by tag. Uses drizzle's own
 * bookkeeping: a migration is applied once `drizzle.__drizzle_migrations` holds a `created_at` at
 * or after its journal time, the same test the migrator uses.
 */
export async function pendingMigrations(db: Database, migrationsFolder = DEFAULT_MIGRATIONS_FOLDER): Promise<string[]> {
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const [table] = await queryRows<{ present: boolean }>(db, sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`);
  let lastApplied = -1;
  if (table?.present) {
    const [latest] = await queryRows<{ created_at: string | null }>(db, sql`SELECT max(created_at)::text AS created_at FROM drizzle.__drizzle_migrations`);
    if (latest?.created_at) lastApplied = Number(latest.created_at);
  }
  return journal.entries.filter((entry) => entry.when > lastApplied).map((entry) => entry.tag);
}
