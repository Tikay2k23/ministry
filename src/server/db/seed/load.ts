import { sql } from 'drizzle-orm';
import { newId } from '@/lib/ids';
import { generatePersonCodes } from '../../modules/people/person-codes';
import { getSetting } from '../../modules/settings/settings.service';
import { queryRows, type Database } from '../client';
import { hierarchyClosure, hierarchyNodes, people, personDesignations } from '../schema';

/**
 * A ministry big enough to find slow queries in (docs/07 §7 "Performance", M5.5).
 *
 * The shape is the real one — a pastor over Primary Leaders, each with twelve leaders of twelve
 * people — repeated until the requested size is reached, so branch queries meet realistic group
 * sizes and tree depths rather than one enormous group.
 *
 * People and the tree are written in chunks from here; the ledger is written by the database
 * itself, a day at a time, because 50,000 people over three years is 55 million rows and sending
 * those from Node would take hours. Nothing here goes through the services, so it is quick but it
 * assumes the schema: keep it beside `demo.ts`, which seeds the small development ministry.
 */

export interface LoadSeedOptions {
  /** How many people to create (the tree rounds up to whole branches of 157). */
  people: number;
  /** How many days of ledger to write, ending today. */
  days: number;
  /** How many of the most recent days also get journals with answers to read and review. */
  entryDays: number;
  onProgress?: (message: string) => void;
}

const FIRST = ['Angelo', 'Bea', 'Carlo', 'Divina', 'Eduardo', 'Fely', 'Gerald', 'Hazel', 'Ivan', 'Joy', 'Kristine', 'Lito', 'Marites', 'Noel', 'Olive', 'Paolo', 'Queenie', 'Ramon', 'Sheila', 'Teddy'];
const LAST = ['Aguilar', 'Bautista', 'Cruz', 'Dizon', 'Espiritu', 'Fernandez', 'Gonzales', 'Hernandez', 'Ilagan', 'Javier', 'Lim', 'Mendoza', 'Navarro', 'Ocampo', 'Perez', 'Quinto', 'Reyes', 'Santos', 'Torres', 'Villanueva'];

/** Deterministic, so two runs produce the same ministry. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export async function seedLoadData(db: Database, options: LoadSeedOptions) {
  const say = options.onProgress ?? (() => {});
  const rand = random(20260918);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const { primaryLeaderDepth } = await getSetting(db, 'hierarchy');

  // `npm run db:seed` leaves the first administrator behind, so a handful of people is expected;
  // a ministry's worth is not — this data belongs in a disposable database.
  const [existingRow] = await queryRows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM people`);
  const existing = Number(existingRow?.n ?? 0);
  if (existing > 50) throw new Error(`The database already holds ${existing} people. Load data belongs in an empty, disposable database.`);

  // ── The tree ────────────────────────────────────────────────────────────────
  interface Planned {
    id: string;
    parentId: string | null;
    depth: number;
    ancestors: string[];
    kind: 'pastor' | 'primary' | 'leader' | 'member';
  }
  const planned: Planned[] = [];
  const add = (parent: Planned | null, kind: Planned['kind']): Planned => {
    const node: Planned = {
      id: newId(),
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      ancestors: parent ? [parent.id, ...parent.ancestors] : [],
      kind,
    };
    planned.push(node);
    return node;
  };

  const pastor = add(null, 'pastor');
  const perBranch = 1 + 12 + 12 * 12; // a Primary Leader, twelve leaders, twelve people each
  const branches = Math.max(1, Math.ceil((options.people - 1) / perBranch));
  for (let b = 0; b < branches; b++) {
    const primary = add(pastor, 'primary');
    for (let l = 0; l < 12; l++) {
      const leader = add(primary, 'leader');
      for (let m = 0; m < 12; m++) add(leader, 'member');
    }
  }
  say(`${planned.length.toLocaleString('en-PH')} people in ${branches} branches`);

  const codes = await generatePersonCodes(db, planned.length);
  const chunk = async <T>(rows: T[], size: number, insert: (part: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
  };

  await chunk(planned, 1000, (part) =>
    db.insert(people).values(
      part.map((p) => {
        const index = planned.indexOf(p);
        return {
          id: p.id,
          personCode: codes[index]!,
          firstName: pick(FIRST),
          lastName: pick(LAST),
          gender: rand() < 0.5 ? ('male' as const) : ('female' as const),
          phoneE164: `+63901${String(index + 1).padStart(7, '0')}`,
          birthMonth: 1 + Math.floor(rand() * 12),
          birthDay: 1 + Math.floor(rand() * 28),
          source: 'import' as const,
          journalExpected: p.kind !== 'pastor',
        };
      }),
    ),
  );
  say('people written');

  await chunk(planned, 2000, (part) => db.insert(personDesignations).values(part.map((p) => ({ personId: p.id, designationKey: p.kind === 'pastor' ? 'pastor' : p.kind === 'member' ? 'member' : 'worker' }))));

  // `ancestors` is nearest first, so the one at `primaryLeaderDepth` sits at depth - 1 - that.
  const primaryOf = (p: Planned) => {
    if (p.depth < primaryLeaderDepth) return null;
    if (p.depth === primaryLeaderDepth) return p.id;
    return p.ancestors[p.depth - 1 - primaryLeaderDepth] ?? null;
  };
  await chunk(planned, 1000, (part) =>
    db.insert(hierarchyNodes).values(
      part.map((p) => ({ personId: p.id, parentPersonId: p.parentId, depth: p.depth, primaryLeaderPersonId: primaryOf(p), acceptsMembers: p.kind === 'leader' || p.kind === 'primary' })),
    ),
  );
  const closure = planned.flatMap((p) => [{ ancestorId: p.id, descendantId: p.id, depth: 0 }, ...p.ancestors.map((a, i) => ({ ancestorId: a, descendantId: p.id, depth: i + 1 }))]);
  await chunk(closure, 5000, (part) => db.insert(hierarchyClosure).values(part));
  say(`tree written (${closure.length.toLocaleString('en-PH')} closure rows)`);

  // ── The ledger, written by the database ─────────────────────────────────────
  // One day at a time: each statement stays a sane size and progress is visible.
  await db.execute(sql`
    CREATE TEMP TABLE load_person AS
    SELECT n.person_id,
           n.parent_person_id,
           n.primary_leader_person_id,
           COALESCE((SELECT array_agg(hc.ancestor_id ORDER BY hc.depth DESC) FROM hierarchy_closure hc WHERE hc.descendant_id = n.person_id AND hc.depth > 0), '{}') AS path
    FROM hierarchy_nodes n
    JOIN people p ON p.id = n.person_id AND p.journal_expected`);
  await db.execute(sql`CREATE INDEX ON load_person (person_id)`);

  const [form] = await queryRows<{ id: string }>(
    db,
    sql`SELECT fv.id FROM form_versions fv JOIN forms f ON f.id = fv.form_id WHERE f.key = 'daily_journal' ORDER BY fv.version_no DESC LIMIT 1`,
  );
  if (!form) throw new Error('No daily_journal form: run `npm run db:seed` first.');

  // A day at a time, and in one statement each: the ledger only accepts a submitted day together
  // with its journal (`journal_days_entry_consistency`), so the response, its answers, the entry
  // and the day are written by the same statement. Days beyond `entryDays` are left as days people
  // missed or were excused from, which need no journal.
  for (let back = options.days - 1; back >= 0; back--) {
    const withJournals = back < options.entryDays;
    const today = back === 0;
    await db.execute(sql`
      WITH pick AS MATERIALIZED (
        SELECT lp.person_id,
               lp.parent_person_id,
               lp.primary_leader_person_id,
               lp.path,
               random() AS r,
               random() AS r2,
               gen_random_uuid() AS response_id,
               gen_random_uuid() AS entry_id,
               (CURRENT_DATE - ${back}::int)::date AS day,
               ((CURRENT_DATE - ${back}::int)::date + time '20:30') AT TIME ZONE 'Asia/Manila' AS at
        FROM load_person lp
      ),
      response AS (
        INSERT INTO form_responses (id, form_version_id, person_id, submitted_at)
        SELECT response_id, ${form.id}::uuid, person_id, at FROM pick WHERE ${withJournals} AND r < 0.88
        RETURNING id
      ),
      answers AS (
        INSERT INTO form_answer_sets (response_id, sensitivity, answers)
        SELECT response_id, 'standard',
               jsonb_build_object('scripture', 'Psalm 23', 'reflection', 'Synthetic journal for load testing.', 'gratitude', 'Thankful today.')
        FROM pick WHERE ${withJournals} AND r < 0.88
        RETURNING response_id
      ),
      entry AS (
        INSERT INTO journal_entries (id, person_id, journal_date, form_response_id, first_submitted_at, last_submitted_at, timing, channel)
        SELECT entry_id, person_id, day, response_id, at, at, CASE WHEN r < 0.80 THEN 'on_time' ELSE 'late' END, 'personal_link'
        FROM pick WHERE ${withJournals} AND r < 0.88
        RETURNING id
      )
      INSERT INTO journal_days (person_id, journal_date, is_expected, submission_status, review_status, excuse_reason, entry_id, leader_person_id, primary_leader_person_id, hierarchy_path, finalized_at)
      SELECT person_id,
             day,
             true,
             CASE
               WHEN ${withJournals} AND r < 0.80 THEN 'submitted'
               WHEN ${withJournals} AND r < 0.88 THEN 'late'
               WHEN ${today} THEN 'pending'
               WHEN r < 0.96 THEN 'missed'
               ELSE 'excused'
             END,
             CASE WHEN ${withJournals} AND r < 0.88 THEN (CASE WHEN r2 < 0.45 THEN 'awaiting' ELSE 'reviewed' END) ELSE 'none' END,
             CASE WHEN (NOT ${withJournals} OR r >= 0.88) AND NOT ${today} AND r >= 0.96 THEN 'pause' ELSE NULL END,
             CASE WHEN ${withJournals} AND r < 0.88 THEN entry_id ELSE NULL END,
             parent_person_id,
             primary_leader_person_id,
             path,
             CASE WHEN ${today} AND (NOT ${withJournals} OR r >= 0.88) THEN NULL ELSE now() END
      FROM pick
      ON CONFLICT DO NOTHING`);
    if (back % 30 === 0 || back === 0) say(`ledger: ${options.days - back}/${options.days} days`);
  }

  await db.execute(sql`ANALYZE`);
  const [counts] = await queryRows<{ people: number; days: number; entries: number }>(
    db,
    sql`SELECT (SELECT count(*) FROM people)::int AS people, (SELECT count(*) FROM journal_days)::int AS days, (SELECT count(*) FROM journal_entries)::int AS entries`,
  );
  return { people: Number(counts?.people ?? 0), days: Number(counts?.days ?? 0), entries: Number(counts?.entries ?? 0), branches };
}
