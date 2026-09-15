/**
 * `npm run db:migrate` — applies pending migrations.
 * Uses DATABASE_URL_MIGRATOR when set (a role with DDL rights), otherwise DATABASE_URL.
 */
import { getEnv } from '../../env';
import { openDatabase } from '../client';
import { runMigrations } from '../migrate';

const env = getEnv();
const handle = openDatabase(env.DATABASE_URL_MIGRATOR ?? env.DATABASE_URL);

try {
  await runMigrations(handle);
  console.log(`✓ Migrations applied (${handle.kind}).`);
} finally {
  await handle.close();
}
