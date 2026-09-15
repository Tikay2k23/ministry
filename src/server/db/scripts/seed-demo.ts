/**
 * `npm run db:seed:demo` — DEMO DATA for development (1,885 fictional people).
 * Refuses to run in production or against a real PostgreSQL server unless --allow-postgres
 * is passed explicitly (e.g. for a disposable staging database).
 */
import { getEnv } from '../../env';
import { openDatabase } from '../client';
import { seedDemoData } from '../seed/demo';

const env = getEnv();
if (env.NODE_ENV === 'production') {
  console.error('✗ Refusing to load demo data in production.');
  process.exit(1);
}
if (!env.DATABASE_URL.startsWith('pglite:') && !process.argv.includes('--allow-postgres')) {
  console.error('✗ DATABASE_URL is a real PostgreSQL server. Pass --allow-postgres if this is a disposable database.');
  process.exit(1);
}

const handle = openDatabase(env.DATABASE_URL);
try {
  const started = Date.now();
  const result = await seedDemoData(handle.db);
  if (!result.created) {
    console.log('ℹ Demo data is already present — nothing to do.');
  } else {
    console.log(`✓ Demo ministry created: ${result.people.toLocaleString('en-PH')} people in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    console.log('  Demo portal accounts (sign in with a magic link printed by `npm run dev`):');
    for (const account of result.accounts) console.log(`   • ${account}`);
  }
} finally {
  await handle.close();
}
