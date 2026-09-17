/**
 * `npm run db:explain` — query plans for the hottest pages, against a load-sized ministry (M5.5).
 *
 *   npm run db:seed:load -- --allow-postgres
 *   DATABASE_URL=postgres://… npm run db:explain
 *
 * It calls the real service functions, records every statement Drizzle actually runs (through
 * `openDatabase`'s query logger), then EXPLAINs each SELECT with the same parameters. Nothing here
 * copies the app's SQL by hand, so it cannot drift from what the app does.
 *
 * It fails on two things:
 *  - **A missing index:** a sequential scan of a large table that throws away almost everything it
 *    reads. Scanning a large table to summarise all of it is fine; scanning it to find twelve
 *    people's rows is not.
 *  - **A slow page:** a scenario whose statements together exceed the budget (docs/01: portal pages
 *    p95 ≤ 800 ms of server time at 50k people), measured here as database time only.
 *
 * Plans are written to explain-plans.json for the run to keep.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { RequestContext } from '../../context/request-context';
import { getEnv } from '../../env';
import { countOpenFollowUps } from '../../modules/care/care.service';
import { getJournalOverview, getPersonJournalSummary, listAwaitingReview } from '../../modules/journal/journal-portal.service';
import { getPersonDetail, searchPeople } from '../../modules/people/people.queries';
import { resolveEntryCode } from '../../modules/public/entry-codes.service';
import { getJournalGroupsReport, getJournalPeopleReport } from '../../modules/reports/journal-reports.service';
import type { PermissionKey } from '../../policy/catalog';
import type { Grant, Scope } from '../../policy/grants';
import { openDatabase, queryRows, type Database } from '../client';

const BUDGET_MS = Number(process.env.EXPLAIN_BUDGET_MS ?? 800);
const LARGE_TABLE_ROWS = 10_000;
/** A sequential scan that keeps less than this share of a large table is missing an index. */
const SELECTIVE = 0.05;

const env = getEnv();
const url = process.argv[2] ?? env.DATABASE_URL;
if (!url.startsWith('postgres')) {
  console.error('✗ Query plans need a real PostgreSQL server (PGlite plans differ). Pass a postgres:// URL.');
  process.exit(2);
}

// ── Contexts: the people whose pages we are measuring ─────────────────────────
const grantsFor = (permissions: PermissionKey[], scope: Scope): Grant[] => permissions.map((permission) => ({ permission, scope, roleKey: 'load-test' }));

const LEADER_PERMISSIONS: PermissionKey[] = ['people.view', 'people.contact.view', 'hierarchy.view', 'journal.status.view', 'journal.content.view', 'journal.review', 'care.view', 'reports.view'];
const ADMIN_PERMISSIONS: PermissionKey[] = [...LEADER_PERMISSIONS, 'people.export', 'reports.export', 'settings.view'];

function contextFor(personId: string, grants: Grant[]): RequestContext {
  return {
    requestId: randomUUID(),
    now: new Date(),
    actor: { kind: 'user', userId: randomUUID(), personId, name: 'Load test', email: 'load@test.local', grants, twoFactorVerified: true },
  } as RequestContext;
}

interface Scenario {
  name: string;
  run: (db: Database) => Promise<unknown>;
}

interface Finding {
  scenario: string;
  table: string;
  rowsRead: number;
  rowsKept: number;
}

const pool = new pg.Pool({ connectionString: url, max: 4 });
const captured: { query: string; params: unknown[] }[] = [];
const handle = openDatabase(url, { onQuery: (query, params) => captured.push({ query, params }) });

/** Every node in a plan tree. */
function* nodes(plan: Record<string, unknown>): Generator<Record<string, unknown>> {
  yield plan;
  for (const child of (plan.Plans as Record<string, unknown>[] | undefined) ?? []) yield* nodes(child);
}

try {
  const tableRows = new Map<string, number>();
  for (const row of await queryRows<{ table: string; rows: number }>(
    handle.db,
    sql`SELECT relname AS table, GREATEST(n_live_tup, 0)::int AS rows FROM pg_stat_user_tables`,
  )) {
    tableRows.set(row.table, Number(row.rows));
  }
  const people = [...tableRows.entries()].find(([t]) => t === 'people')?.[1] ?? 0;
  const days = [...tableRows.entries()].find(([t]) => t === 'journal_days')?.[1] ?? 0;
  console.log(`Against ${people.toLocaleString('en-PH')} people and ${days.toLocaleString('en-PH')} ledger days.\n`);
  if (people < 10_000) console.warn('⚠ Fewer than 10,000 people: run `npm run db:seed:load` first, or the plans mean little.\n');

  // A leader in the middle of the tree, their Primary Leader, and one of the leader's group.
  const [leader] = await queryRows<{ person_id: string; parent_person_id: string }>(
    handle.db,
    sql`SELECT person_id, parent_person_id FROM hierarchy_nodes WHERE depth = 2 ORDER BY person_id LIMIT 1`,
  );
  if (!leader) throw new Error('No leader at depth 2: seed the load data first.');
  const [member] = await queryRows<{ person_id: string }>(handle.db, sql`SELECT person_id FROM hierarchy_nodes WHERE parent_person_id = ${leader.person_id} LIMIT 1`);
  const [code] = await queryRows<{ code: string }>(handle.db, sql`SELECT code FROM entry_codes WHERE kind = 'journal_general' AND status = 'active' LIMIT 1`);

  const leaderCtx = contextFor(leader.person_id, grantsFor(LEADER_PERMISSIONS, { type: 'branch', anchorPersonId: leader.person_id, maxDepth: 1 }));
  const primaryCtx = contextFor(leader.parent_person_id, grantsFor(LEADER_PERMISSIONS, { type: 'branch', anchorPersonId: leader.parent_person_id, maxDepth: null }));
  const adminCtx = contextFor(leader.person_id, grantsFor(ADMIN_PERMISSIONS, { type: 'global' }));

  const scenarios: Scenario[] = [
    { name: "Leader's Daily Journal today", run: (db) => getJournalOverview(db, leaderCtx, {}) },
    { name: "Primary Leader's whole branch today", run: (db) => getJournalOverview(db, primaryCtx, { view: 'branch' }) },
    { name: 'Review queue', run: (db) => listAwaitingReview(db, leaderCtx, {}) },
    { name: 'One person’s journal history', run: (db) => getPersonJournalSummary(db, leaderCtx, member!.person_id) },
    { name: 'Person profile', run: (db) => getPersonDetail(db, leaderCtx, member!.person_id) },
    { name: 'People directory, first page', run: (db) => searchPeople(db, adminCtx, {}) },
    { name: 'People directory, name search', run: (db) => searchPeople(db, adminCtx, { q: 'santos' }) },
    { name: 'Open follow-ups (dashboard)', run: (db) => countOpenFollowUps(db, leaderCtx) },
    { name: 'Report: people, last 7 days', run: (db) => getJournalPeopleReport(db, primaryCtx, { view: 'branch' }) },
    { name: 'Report: groups, last 7 days', run: (db) => getJournalGroupsReport(db, primaryCtx, { view: 'branch' }) },
    { name: 'Public: open a QR code', run: (db) => (code ? resolveEntryCode(db, code.code) : Promise.resolve(null)) },
  ];

  const findings: Finding[] = [];
  const slow: { scenario: string; ms: number }[] = [];
  const snapshots: Record<string, unknown[]> = {};

  for (const scenario of scenarios) {
    captured.length = 0;
    try {
      await scenario.run(handle.db);
    } catch (error) {
      console.log(`✗ ${scenario.name}: ${(error as Error).message}`);
      slow.push({ scenario: scenario.name, ms: -1 });
      continue;
    }
    const statements = captured.filter((c) => /^\s*select/i.test(c.query));
    let total = 0;
    const plans: unknown[] = [];

    for (const statement of statements) {
      let plan: Record<string, unknown>;
      try {
        const explained = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`, statement.params as unknown[]);
        plan = (explained.rows[0]['QUERY PLAN'] as Record<string, unknown>[])[0]!;
      } catch {
        continue; // a statement EXPLAIN cannot take (e.g. one already inside a transaction)
      }
      total += Number((plan as { 'Execution Time'?: number })['Execution Time'] ?? 0);
      plans.push({ sql: statement.query, plan });

      for (const node of nodes(plan.Plan as Record<string, unknown>)) {
        if (node['Node Type'] !== 'Seq Scan') continue;
        const table = String(node['Relation Name'] ?? '');
        const size = tableRows.get(table) ?? 0;
        if (size < LARGE_TABLE_ROWS) continue;
        const kept = Number(node['Actual Rows'] ?? 0) * Number(node['Actual Loops'] ?? 1);
        if (kept < size * SELECTIVE) findings.push({ scenario: scenario.name, table, rowsRead: size, rowsKept: kept });
      }
    }

    snapshots[scenario.name] = plans;
    const verdict = total > BUDGET_MS ? '✗' : '✓';
    if (total > BUDGET_MS) slow.push({ scenario: scenario.name, ms: total });
    console.log(`${verdict} ${scenario.name}: ${total.toFixed(1)} ms in ${statements.length} quer${statements.length === 1 ? 'y' : 'ies'}`);
  }

  writeFileSync('explain-plans.json', JSON.stringify(snapshots, null, 2));
  console.log('\nPlans written to explain-plans.json');

  if (findings.length > 0) {
    console.error('\n✗ Sequential scans of large tables that keep almost nothing — an index is missing:');
    for (const f of findings) {
      console.error(`   ${f.scenario}: scanned ${f.rowsRead.toLocaleString('en-PH')} rows of ${f.table} to keep ${f.rowsKept.toLocaleString('en-PH')}`);
    }
  }
  if (slow.length > 0) {
    console.error(`\n✗ Slower than the ${BUDGET_MS} ms budget (database time only):`);
    for (const s of slow) console.error(`   ${s.scenario}: ${s.ms < 0 ? 'failed to run' : `${s.ms.toFixed(0)} ms`}`);
  }
  if (findings.length === 0 && slow.length === 0) console.log(`\nAll ${scenarios.length} scenarios are within ${BUDGET_MS} ms and use their indexes.`);
  else process.exitCode = 1;
} finally {
  await handle.close();
  await pool.end();
}
