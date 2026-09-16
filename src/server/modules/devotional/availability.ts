import { sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';

/**
 * Who can serve when (docs/05 W8 step 4, W14): unavailable dates, other gatherings at the same
 * time, and when someone last served in a role. Used by roster filling, warnings and substitute
 * suggestions.
 */

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/** People (of `personIds`) marked unavailable at any point during [startsAt, endsAt). */
export async function unavailablePeople(executor: Executor, personIds: string[], startsAt: Date, endsAt: Date): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await queryRows<{ person_id: string }>(
    executor,
    sql`SELECT DISTINCT person_id FROM person_unavailability
         WHERE person_id IN (${idList(personIds)})
           AND tstzrange(starts_at, ends_at) && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz)`,
  );
  return new Set(rows.map((row) => row.person_id));
}

/** People (of `personIds`) already serving in another gathering that overlaps [startsAt, endsAt) (BR-D-02). */
export async function peopleServingElsewhere(
  executor: Executor,
  personIds: string[],
  window: { startsAt: Date; endsAt: Date; exceptGatheringId: string },
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await queryRows<{ person_id: string }>(
    executor,
    sql`SELECT DISTINCT ga.person_id
          FROM gathering_assignments ga
          JOIN gatherings g ON g.id = ga.gathering_id AND g.status = 'scheduled'
         WHERE ga.person_id IN (${idList(personIds)})
           AND ga.status IN ('pending', 'confirmed')
           AND g.id <> ${window.exceptGatheringId}::uuid
           AND tstzrange(g.starts_at, g.ends_at) && tstzrange(${window.startsAt.toISOString()}::timestamptz, ${window.endsAt.toISOString()}::timestamptz)`,
  );
  return new Set(rows.map((row) => row.person_id));
}

/** When each person last served (or is due to serve) in each role, before `before`. Key: `${personId}:${roleId}`. */
export async function lastServed(executor: Executor, personIds: string[], before: Date): Promise<Map<string, Date>> {
  if (personIds.length === 0) return new Map();
  const rows = await queryRows<{ person_id: string; serving_role_id: string; last_at: Date | string }>(
    executor,
    sql`SELECT ga.person_id, ga.serving_role_id, max(g.starts_at) AS last_at
          FROM gathering_assignments ga
          JOIN gatherings g ON g.id = ga.gathering_id AND g.status <> 'cancelled'
         WHERE ga.person_id IN (${idList(personIds)})
           AND ga.status IN ('pending', 'confirmed')
           AND g.starts_at < ${before.toISOString()}::timestamptz
         GROUP BY ga.person_id, ga.serving_role_id`,
  );
  return new Map(rows.map((row) => [`${row.person_id}:${row.serving_role_id}`, new Date(row.last_at)]));
}
