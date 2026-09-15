import 'server-only';
import { getEnv } from '../env';
import { openDatabase, type Database, type DatabaseHandle } from '../db/client';

/**
 * Process-wide database for the Next.js runtime. Kept on globalThis so development
 * hot-reloads reuse one connection pool / one embedded PGlite instance.
 */
const globalForDb = globalThis as unknown as { __gentouchDb?: DatabaseHandle };

export function getDb(): Database {
  globalForDb.__gentouchDb ??= openDatabase(getEnv().DATABASE_URL);
  return globalForDb.__gentouchDb.db;
}
