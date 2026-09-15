import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { DatabaseHandle, Schema } from './client';

/** Applies every pending SQL migration in ./drizzle, in order, inside drizzle's migration table. */
export async function runMigrations(
  handle: DatabaseHandle,
  migrationsFolder = path.join(process.cwd(), 'drizzle'),
): Promise<void> {
  if (handle.kind === 'pglite') {
    await migratePglite(handle.db as unknown as PgliteDatabase<Schema>, { migrationsFolder });
  } else {
    await migrateNodePg(handle.db as unknown as NodePgDatabase<Schema>, { migrationsFolder });
  }
}
