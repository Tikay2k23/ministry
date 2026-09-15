import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { queryRows, type Database, type Executor } from '../../db/client';
import { careFollowups, journalDays, journalLedgerRuns, ministryCalendarDays } from '../../db/schema';
import { getSetting } from '../settings/settings.service';
import { addDays, closeInstant, localDate } from './journal-dates';

/**
 * The accountability ledger (docs/03 §4.7, docs/05 W6), maintained idempotently:
 *   open    — one row per expected person for a day (rest days / pauses → excused)
 *   resync  — after structural changes: snapshots, expectations and automatic excusals
 *   close   — at the late cutoff: not yet → missed; consecutive-miss follow-ups
 * `ensureJournalLedger` is safe to call on every read and submission (it is cheap when there
 * is nothing to do), so correctness never depends on a scheduled job having run.
 */

const LEDGER_LOCK_KEY = 7301;
const MAX_CATCH_UP_DAYS = 14;

/** A person the ledger expects a journal from. `p` = people, joined to hierarchy_nodes. */
const EXPECTED_PERSON = sql`p.archived_at IS NULL AND p.status = 'active' AND p.registration_status = 'confirmed' AND p.journal_expected`;

const ancestorPath = (personRef: ReturnType<typeof sql>) =>
  sql`coalesce((SELECT array_agg(c.ancestor_id ORDER BY c.depth DESC) FROM hierarchy_closure c
               WHERE c.descendant_id = ${personRef} AND c.depth > 0), '{}'::uuid[])`;

const pausedOn = (personRef: ReturnType<typeof sql>, date: string) =>
  sql`EXISTS (SELECT 1 FROM journal_pauses jp WHERE jp.person_id = ${personRef} AND jp.cancelled_at IS NULL
              AND jp.starts_on <= ${date}::date AND (jp.ends_on IS NULL OR jp.ends_on >= ${date}::date))`;

async function isRestDay(executor: Executor, date: string): Promise<boolean> {
  const [row] = await executor
    .select({ day: ministryCalendarDays.day })
    .from(ministryCalendarDays)
    .where(and(eq(ministryCalendarDays.day, date), eq(ministryCalendarDays.excusesJournal, true)));
  return Boolean(row);
}

/** Inserts missing ledger rows for everyone expected on `date` (never touches existing rows). */
export async function openJournalDay(executor: Executor, date: string): Promise<void> {
  const rest = await isRestDay(executor, date);
  await executor.execute(sql`
    INSERT INTO journal_days (person_id, journal_date, is_expected, submission_status, excuse_reason,
                              leader_person_id, primary_leader_person_id, hierarchy_path)
    SELECT p.id, ${date}::date,
           NOT (${rest} OR ${pausedOn(sql`p.id`, date)}),
           CASE WHEN ${rest} OR ${pausedOn(sql`p.id`, date)} THEN 'excused' ELSE 'pending' END,
           CASE WHEN ${rest} THEN 'rest_day' WHEN ${pausedOn(sql`p.id`, date)} THEN 'pause' END,
           n.parent_person_id, n.primary_leader_person_id, ${ancestorPath(sql`p.id`)}
      FROM people p
      JOIN hierarchy_nodes n ON n.person_id = p.id
     WHERE ${EXPECTED_PERSON}
    ON CONFLICT (person_id, journal_date) DO NOTHING`);
}

/** Re-applies structure, expectations and automatic excusals to an open (unfinalised) day. */
export async function resyncJournalDay(executor: Executor, date: string): Promise<void> {
  const rest = await isRestDay(executor, date);

  // People no longer expected: drop open rows without an entry.
  await executor.execute(sql`
    DELETE FROM journal_days d
     WHERE d.journal_date = ${date}::date AND d.finalized_at IS NULL AND d.entry_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM people p JOIN hierarchy_nodes n ON n.person_id = p.id
                        WHERE p.id = d.person_id AND ${EXPECTED_PERSON})`);

  // Entries from people who left the structure stay, but no longer count as expected.
  await executor.execute(sql`
    UPDATE journal_days d SET is_expected = false, updated_at = now()
     WHERE d.journal_date = ${date}::date AND d.finalized_at IS NULL AND d.entry_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM hierarchy_nodes n WHERE n.person_id = d.person_id)`);

  // Snapshots + automatic excusals for everyone still in the tree. Manual excusals are kept.
  await executor.execute(sql`
    WITH flags AS (
      SELECT d.person_id,
             ${pausedOn(sql`d.person_id`, date)} AS paused,
             EXISTS (SELECT 1 FROM people p JOIN hierarchy_nodes n2 ON n2.person_id = p.id
                      WHERE p.id = d.person_id AND ${EXPECTED_PERSON}) AS qualifies
        FROM journal_days d
       WHERE d.journal_date = ${date}::date AND d.finalized_at IS NULL
    )
    UPDATE journal_days d SET
        leader_person_id = n.parent_person_id,
        primary_leader_person_id = n.primary_leader_person_id,
        hierarchy_path = ${ancestorPath(sql`d.person_id`)},
        is_expected = CASE
            WHEN d.entry_id IS NULL AND d.excuse_reason IN ('leader_excused', 'admin_excused') THEN false
            ELSE f.qualifies AND NOT (${rest} OR f.paused) END,
        submission_status = CASE
            WHEN d.entry_id IS NOT NULL THEN d.submission_status
            WHEN d.excuse_reason IN ('leader_excused', 'admin_excused') THEN d.submission_status
            WHEN ${rest} OR f.paused THEN 'excused'
            ELSE 'pending' END,
        excuse_reason = CASE
            WHEN d.entry_id IS NOT NULL THEN NULL
            WHEN d.excuse_reason IN ('leader_excused', 'admin_excused') THEN d.excuse_reason
            WHEN ${rest} THEN 'rest_day'
            WHEN f.paused THEN 'pause'
            ELSE NULL END,
        updated_at = now()
      FROM flags f, hierarchy_nodes n
     WHERE f.person_id = d.person_id AND n.person_id = d.person_id
       AND d.journal_date = ${date}::date AND d.finalized_at IS NULL`);

  // Newly expected people.
  await openJournalDay(executor, date);
}

/**
 * Closes a day: not yet → missed, everything finalised, and a follow-up suggested to the
 * direct leader when someone reaches the consecutive-miss threshold (excused days neither
 * break nor extend a streak). Nothing is sent to the person.
 */
export async function closeJournalDay(executor: Executor, date: string, now: Date, threshold: number) {
  const nowIso = now.toISOString();
  const missed = await queryRows<{ person_id: string }>(
    executor,
    sql`UPDATE journal_days SET submission_status = 'missed', finalized_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
         WHERE journal_date = ${date}::date AND submission_status = 'pending'
     RETURNING person_id`,
  );
  await executor.execute(
    sql`UPDATE journal_days SET finalized_at = ${nowIso}::timestamptz WHERE journal_date = ${date}::date AND finalized_at IS NULL`,
  );
  if (missed.length === 0) return { missed: 0, followUps: 0 };

  const ids = sql.join(missed.map((m) => sql`${m.person_id}::uuid`), sql`, `);
  const streaks = await queryRows<{ person_id: string; streak: number; streak_start: string; leader_person_id: string | null }>(
    executor,
    sql`
    WITH recent AS (
      SELECT person_id, journal_date, submission_status,
             row_number() OVER (PARTITION BY person_id ORDER BY journal_date DESC) AS rn
        FROM journal_days
       WHERE person_id IN (${ids})
         AND journal_date BETWEEN ${date}::date - 120 AND ${date}::date
         AND submission_status <> 'excused'
    ), stops AS (
      SELECT person_id, min(rn) AS stop FROM recent WHERE submission_status <> 'missed' GROUP BY person_id
    )
    SELECT r.person_id, count(*)::int AS streak, min(r.journal_date)::text AS streak_start,
           (SELECT d.leader_person_id FROM journal_days d WHERE d.person_id = r.person_id AND d.journal_date = ${date}::date) AS leader_person_id
      FROM recent r LEFT JOIN stops s ON s.person_id = r.person_id
     WHERE r.submission_status = 'missed' AND (s.stop IS NULL OR r.rn < s.stop)
     GROUP BY r.person_id
    HAVING count(*) >= ${threshold}`,
  );

  for (const s of streaks) {
    await executor
      .insert(careFollowups)
      .values({
        personId: s.person_id,
        kind: 'journal_missed_streak',
        sourceType: 'journal_day',
        sourceRef: `${s.person_id}:${date}`,
        assignedToPersonId: s.leader_person_id,
        summary: `No journal for ${s.streak} days`,
        dedupeKey: `journal_streak:${s.person_id}:${s.streak_start}`,
      })
      .onConflictDoUpdate({
        target: careFollowups.dedupeKey,
        set: { summary: `No journal for ${s.streak} days`, updatedAt: now },
        setWhere: sql`${careFollowups.status} IN ('open', 'in_progress')`,
      });
    await executor
      .update(journalDays)
      .set({ careStatus: 'needs_follow_up', updatedAt: now })
      .where(and(eq(journalDays.personId, s.person_id), eq(journalDays.journalDate, date)));
  }
  return { missed: missed.length, followUps: streaks.length };
}

export interface LedgerMaintenance {
  opened: string[];
  resynced: string[];
  closed: string[];
}

/**
 * Brings the ledger up to date for `now`: opens today (and catches up on skipped days),
 * applies pending re-syncs, and closes every day whose late cutoff has passed.
 */
export async function ensureJournalLedger(db: Database, now: Date): Promise<LedgerMaintenance> {
  const [{ timezone }, policy] = await Promise.all([getSetting(db, 'ministry.profile'), getSetting(db, 'journal.policy')]);
  const today = localDate(now, timezone);
  const result: LedgerMaintenance = { opened: [], resynced: [], closed: [] };

  const recent = await db.select().from(journalLedgerRuns).orderBy(desc(journalLedgerRuns.journalDate)).limit(MAX_CATCH_UP_DAYS + 2);
  const nothingToDo =
    recent[0]?.journalDate === today &&
    recent.every((r) => r.closedAt || (!r.needsResync && closeInstant(r.journalDate, timezone, policy) > now));
  if (nothingToDo) return result;

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`));
    const runs = await tx.select().from(journalLedgerRuns).orderBy(desc(journalLedgerRuns.journalDate)).limit(MAX_CATCH_UP_DAYS + 2);

    // Open: today on first use; otherwise every day since the last opened one (bounded).
    const latest = runs[0]?.journalDate;
    const toOpen: string[] = [];
    if (!latest) toOpen.push(today);
    else {
      for (let d = addDays(latest, 1); d <= today; d = addDays(d, 1)) toOpen.push(d);
      toOpen.splice(0, Math.max(0, toOpen.length - MAX_CATCH_UP_DAYS));
    }
    for (const date of toOpen) {
      await openJournalDay(tx, date);
      await tx.insert(journalLedgerRuns).values({ journalDate: date, openedAt: now }).onConflictDoNothing();
      result.opened.push(date);
    }

    // Resync open days that were flagged by structural changes.
    for (const run of runs.filter((r) => !r.closedAt && r.needsResync)) {
      await resyncJournalDay(tx, run.journalDate);
      await tx.update(journalLedgerRuns).set({ needsResync: false }).where(eq(journalLedgerRuns.journalDate, run.journalDate));
      result.resynced.push(run.journalDate);
    }

    // Close every open day past its cutoff, oldest first.
    const open = await tx
      .select()
      .from(journalLedgerRuns)
      .where(sql`${journalLedgerRuns.closedAt} IS NULL`)
      .orderBy(asc(journalLedgerRuns.journalDate));
    for (const run of open) {
      if (closeInstant(run.journalDate, timezone, policy) > now) continue;
      const { missed } = await closeJournalDay(tx, run.journalDate, now, policy.missedStreakThreshold);
      const [counts] = await queryRows<{ expected: number }>(
        tx,
        sql`SELECT count(*) FILTER (WHERE is_expected)::int AS expected FROM journal_days WHERE journal_date = ${run.journalDate}::date`,
      );
      await tx
        .update(journalLedgerRuns)
        .set({ closedAt: now, needsResync: false, missedCount: missed, expectedCount: counts?.expected ?? 0 })
        .where(eq(journalLedgerRuns.journalDate, run.journalDate));
      result.closed.push(run.journalDate);
    }
  });
  return result;
}
