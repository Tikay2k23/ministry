import { openDatabase, type DatabaseHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';

/**
 * A fresh, fully migrated in-memory PostgreSQL (PGlite) for one test file.
 * Real PostgreSQL semantics (constraints, extensions, CTEs) without Docker.
 */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const handle = openDatabase('pglite://memory');
  await runMigrations(handle);
  return handle;
}
