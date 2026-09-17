/**
 * `npm run db:check` — reads a database and reports whether it is whole.
 *
 * Written for recovery (docs/runbooks/recovery.md): after restoring a backup, this is how you tell
 * whether the copy is sound before pointing the app at it. It is also rehearsed on every push by
 * the "Backup and restore drill" job in CI. It only reads, so it is safe to run against production.
 *
 * Exit code 0 means every check passed; 1 means at least one failed.
 */
import { sql } from 'drizzle-orm';
import { getEnv } from '../../env';
import { verifyHierarchy } from '../../modules/hierarchy/hierarchy.verify';
import { getSetting } from '../../modules/settings/settings.service';
import { openDatabase, queryRows, type Database } from '../client';
import { pendingMigrations } from '../migrate';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const count = async (db: Database, table: string, where = sql``): Promise<number> => {
  const [row] = await queryRows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} ${where}`);
  return Number(row?.n ?? 0);
};

async function run(db: Database): Promise<Check[]> {
  const checks: Check[] = [];

  const pending = await pendingMigrations(db);
  checks.push({
    name: 'Migrations',
    ok: pending.length === 0,
    detail: pending.length === 0 ? 'all applied' : `missing: ${pending.join(', ')}`,
  });

  // Reference data: without it nobody can be given a role and the public pages have no code.
  const [permissions, roles, generalCodes] = await Promise.all([
    count(db, 'permissions'),
    count(db, 'roles'),
    count(db, 'entry_codes', sql`WHERE kind = 'journal_general' AND status = 'active'`),
  ]);
  checks.push({ name: 'Reference data', ok: permissions > 0 && roles > 0, detail: `${permissions} permissions, ${roles} roles` });
  checks.push({ name: 'General journal code', ok: generalCodes === 1, detail: `${generalCodes} active (expected 1)` });

  const { primaryLeaderDepth } = await getSetting(db, 'hierarchy');
  const hierarchy = await verifyHierarchy(db, primaryLeaderDepth);
  const hierarchyOk = Object.values(hierarchy).every((n) => n === 0);
  checks.push({
    name: 'Leadership tree',
    ok: hierarchyOk,
    // The closure table is rebuilt from the adjacency list and compared row by row.
    detail: hierarchyOk
      ? 'closure table matches the tree, depths and primary leaders are right'
      : `missing ${hierarchy.missingClosureRows}, extra ${hierarchy.extraClosureRows}, wrong depth ${hierarchy.wrongDepth}, wrong primary leader ${hierarchy.wrongPrimaryLeader}`,
  });

  // A node whose parent is not itself a node would make branch queries silently incomplete.
  const [orphans] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM hierarchy_nodes n
        WHERE n.parent_person_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM hierarchy_nodes p WHERE p.person_id = n.parent_person_id)`,
  );
  checks.push({ name: 'Tree has no orphans', ok: Number(orphans?.n ?? 0) === 0, detail: `${orphans?.n ?? 0} node(s) with a missing leader` });

  // Journal answers are worthless without the day they belong to, and vice versa.
  const [strayEntries] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM journal_entries e
        WHERE NOT EXISTS (SELECT 1 FROM journal_days d WHERE d.person_id = e.person_id AND d.journal_date = e.journal_date)`,
  );
  checks.push({ name: 'Journals match their days', ok: Number(strayEntries?.n ?? 0) === 0, detail: `${strayEntries?.n ?? 0} entry/entries without a ledger day` });

  const [people, days, entries, users] = await Promise.all([
    count(db, 'people', sql`WHERE archived_at IS NULL`),
    count(db, 'journal_days'),
    count(db, 'journal_entries'),
    count(db, 'users'),
  ]);
  checks.push({
    name: 'Contents',
    ok: true,
    detail: `${people} people, ${users} portal users, ${days} ledger days, ${entries} journals — compare with what you expect`,
  });

  return checks;
}

const env = getEnv();
const handle = openDatabase(process.argv[2] ?? env.DATABASE_URL);
try {
  const checks = await run(handle.db);
  for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed. Do not put this copy into service.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${checks.length} checks passed (${handle.kind}).`);
  }
} finally {
  await handle.close();
}
