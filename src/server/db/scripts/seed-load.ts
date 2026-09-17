/**
 * `npm run db:seed:load` — a ministry big enough to test performance against (M5.5).
 *
 *   npm run db:seed:load -- --allow-postgres                      50,000 people, 90 days
 *   npm run db:seed:load -- --allow-postgres --people=50000 --days=1095 --entry-days=7
 *
 * Meant for a disposable database: it refuses to run in production, against a database that
 * already holds people, or against a real PostgreSQL server without --allow-postgres. Three years
 * of ledger for 50,000 people is ~55 million rows and takes a while; the default 90 days is enough
 * for the query plans (`npm run db:explain`) and quick enough for CI.
 */
import { getEnv } from '../../env';
import { openDatabase } from '../client';
import { seedLoadData } from '../seed/load';

const arg = (name: string, fallback: number) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const env = getEnv();
if (env.NODE_ENV === 'production') {
  console.error('✗ Refusing to load test data in production.');
  process.exit(1);
}
if (!env.DATABASE_URL.startsWith('pglite:') && !process.argv.includes('--allow-postgres')) {
  console.error('✗ DATABASE_URL is a real PostgreSQL server. Pass --allow-postgres if this is a disposable database.');
  process.exit(1);
}

const handle = openDatabase(env.DATABASE_URL);
const started = Date.now();
try {
  const result = await seedLoadData(handle.db, {
    people: arg('people', 50_000),
    days: arg('days', 90),
    entryDays: arg('entry-days', 3),
    onProgress: (message) => console.log(`  ${message}`),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `✓ ${result.people.toLocaleString('en-PH')} people in ${result.branches} branches, ` +
      `${result.days.toLocaleString('en-PH')} ledger days, ${result.entries.toLocaleString('en-PH')} journals in ${seconds} s.`,
  );
} finally {
  await handle.close();
}
