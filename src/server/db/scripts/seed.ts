/**
 * `npm run db:seed` — idempotent reference data + the first Super Admin (SEED_ADMIN_EMAIL).
 * With PGlite, stop `npm run dev` first: an embedded database directory can only be
 * opened by one process at a time.
 */
import { getEnv } from '../../env';
import { openDatabase } from '../client';
import { seedReferenceData } from '../seed/reference-data';
import { ensureSuperAdmin } from '../seed/super-admin';

const env = getEnv();
const handle = openDatabase(env.DATABASE_URL);

try {
  await seedReferenceData(handle.db);
  console.log('✓ Reference data (permissions, roles, levels, settings, privacy notice).');

  if (env.SEED_ADMIN_EMAIL) {
    const { created } = await ensureSuperAdmin(handle.db, {
      email: env.SEED_ADMIN_EMAIL,
      firstName: env.SEED_ADMIN_FIRST_NAME ?? 'Ministry',
      lastName: env.SEED_ADMIN_LAST_NAME ?? 'Administrator',
    });
    console.log(`✓ Super Admin ${created ? 'created' : 'already present'}: ${env.SEED_ADMIN_EMAIL}`);
  } else {
    console.log('ℹ SEED_ADMIN_EMAIL not set — no Super Admin created.');
  }
} finally {
  await handle.close();
}
