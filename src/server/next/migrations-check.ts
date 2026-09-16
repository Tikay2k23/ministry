import 'server-only';
import { pendingMigrations } from '../db/migrate';
import { logger } from '../logger';
import { getDb } from './db';

/**
 * Development only (started from src/instrumentation.ts): says so when the code has migrations the
 * database hasn't applied. Otherwise the first signed-in page fails with a bare "Failed query",
 * because the code already selects columns the database doesn't have yet.
 */
export async function warnAboutPendingMigrations(): Promise<void> {
  let pending: string[];
  try {
    pending = await pendingMigrations(getDb());
  } catch {
    return; // no database configured yet, or no migrations folder: other startup messages cover it
  }
  if (pending.length === 0) return;
  logger.warn(
    `The database is missing ${pending.length === 1 ? 'a migration' : `${pending.length} migrations`} (${pending.join(', ')}). ` +
      'Pages will fail until you stop the server, run `npm run db:setup`, and start it again.',
  );
}
