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
  ms?: number;
}

/** Prints each result as it lands: at 50,000 people the tree check alone takes minutes. */
function report(check: Check): Check {
  console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}${check.ms !== undefined ? ` (${(check.ms / 1000).toFixed(1)} s)` : ''}`);
  return check;
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  const result = await run();
  return [result, Date.now() - started];
}

const count = async (db: Database, table: string, where = sql``): Promise<number> => {
  const [row] = await queryRows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} ${where}`);
  return Number(row?.n ?? 0);
};

async function run(db: Database): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(report(check));

  const [pending, pendingMs] = await timed(() => pendingMigrations(db));
  add({
    name: 'Migrations',
    ok: pending.length === 0,
    detail: pending.length === 0 ? 'all applied' : `missing: ${pending.join(', ')}`,
    ms: pendingMs,
  });

  // Reference data: without it nobody can be given a role and the public pages have no code.
  const [reference, referenceMs] = await timed(() =>
    Promise.all([count(db, 'permissions'), count(db, 'roles'), count(db, 'entry_codes', sql`WHERE kind = 'journal_general' AND status = 'active'`)]),
  );
  const [permissions, roles, generalCodes] = reference;
  add({ name: 'Reference data', ok: permissions > 0 && roles > 0, detail: `${permissions} permissions, ${roles} roles`, ms: referenceMs });
  add({ name: 'General journal code', ok: generalCodes === 1, detail: `${generalCodes} active (expected 1)` });

  // The closure table is rebuilt from the adjacency list and compared row by row. This is the slow
  // one: minutes at 50,000 people, because it walks the whole tree.
  const { primaryLeaderDepth } = await getSetting(db, 'hierarchy');
  const [hierarchy, hierarchyMs] = await timed(() => verifyHierarchy(db, primaryLeaderDepth));
  const hierarchyOk = Object.values(hierarchy).every((n) => n === 0);
  add({
    name: 'Leadership tree',
    ok: hierarchyOk,
    detail: hierarchyOk
      ? 'closure table matches the tree, depths and primary leaders are right'
      : `missing ${hierarchy.missingClosureRows}, extra ${hierarchy.extraClosureRows}, wrong depth ${hierarchy.wrongDepth}, wrong primary leader ${hierarchy.wrongPrimaryLeader}`,
    ms: hierarchyMs,
  });

  // A node whose parent is not itself a node would make branch queries silently incomplete.
  const [orphanRows, orphanMs] = await timed(() =>
    queryRows<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM hierarchy_nodes n
          WHERE n.parent_person_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM hierarchy_nodes p WHERE p.person_id = n.parent_person_id)`,
    ),
  );
  add({ name: 'Tree has no orphans', ok: Number(orphanRows[0]?.n ?? 0) === 0, detail: `${orphanRows[0]?.n ?? 0} node(s) with a missing leader`, ms: orphanMs });

  // Journal answers are worthless without the day they belong to, and vice versa.
  const [strayRows, strayMs] = await timed(() =>
    queryRows<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM journal_entries e
          WHERE NOT EXISTS (SELECT 1 FROM journal_days d WHERE d.person_id = e.person_id AND d.journal_date = e.journal_date)`,
    ),
  );
  add({ name: 'Journals match their days', ok: Number(strayRows[0]?.n ?? 0) === 0, detail: `${strayRows[0]?.n ?? 0} entry/entries without a ledger day`, ms: strayMs });

  const [contents, contentsMs] = await timed(() =>
    Promise.all([count(db, 'people', sql`WHERE archived_at IS NULL`), count(db, 'journal_days'), count(db, 'journal_entries'), count(db, 'users')]),
  );
  const [people, days, entries, users] = contents;
  add({
    name: 'Contents',
    ok: true,
    detail: `${people} people, ${users} portal users, ${days} ledger days, ${entries} journals — compare with what you expect`,
    ms: contentsMs,
  });

  return checks;
}

const env = getEnv();
const handle = openDatabase(process.argv[2] ?? env.DATABASE_URL);
try {
  const checks = await run(handle.db);
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
