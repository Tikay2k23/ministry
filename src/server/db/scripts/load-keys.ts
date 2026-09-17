/**
 * `npm run db:load-keys -- --count=3000 > load/keys.json` — remembered-device keys for the load test.
 *
 * The public journal limits submissions per person (10 a minute), not per address, so a load test
 * with a few thousand people behind it needs no exception to the rate limits and tests exactly what
 * a member's phone does. Identification is limited per address, which is why the keys are issued
 * here rather than by signing in a few thousand times from one machine.
 *
 * Disposable databases only: these keys let the holder journal as those people.
 */
import { sql } from 'drizzle-orm';
import { getEnv } from '../../env';
import { issueParticipantKey } from '../../modules/public/participants.service';
import { openDatabase, queryRows } from '../client';

const arg = (name: string, fallback: number) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const env = getEnv();
if (env.NODE_ENV === 'production') {
  console.error('✗ Refusing to issue load-test keys in production.');
  process.exit(1);
}
if (!env.DATABASE_URL.startsWith('pglite:') && !process.argv.includes('--allow-postgres')) {
  console.error('✗ DATABASE_URL is a real PostgreSQL server. Pass --allow-postgres if this is a disposable database.');
  process.exit(1);
}

const handle = openDatabase(env.DATABASE_URL);
try {
  const count = arg('count', 3000);
  // People at the bottom of the tree: the ones who actually journal.
  const people = await queryRows<{ person_id: string }>(handle.db, sql`SELECT person_id FROM hierarchy_nodes WHERE depth >= 3 ORDER BY person_id LIMIT ${count}`);
  const now = new Date();
  const keys: { personId: string; key: string }[] = [];
  for (const person of people) {
    const issued = await issueParticipantKey(handle.db, { personId: person.person_id, createdVia: 'personal_link', persistent: true, now, userAgent: 'k6-load-test' });
    keys.push({ personId: person.person_id, key: issued.secret });
  }
  process.stdout.write(JSON.stringify(keys, null, 0));
  console.error(`✓ ${keys.length.toLocaleString('en-PH')} device keys issued.`);
} finally {
  await handle.close();
}
