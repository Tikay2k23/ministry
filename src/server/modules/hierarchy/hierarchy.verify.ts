import { sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';

export interface HierarchyVerification {
  missingClosureRows: number;
  extraClosureRows: number;
  wrongDepth: number;
  wrongPrimaryLeader: number;
}

/**
 * Recomputes the closure from the adjacency list with a recursive CTE and diffs it against
 * `hierarchy_closure`, depths and primary leaders. All counts are zero when consistent.
 * Used by the property tests and the nightly `hierarchy.verify` job.
 */
export async function verifyHierarchy(executor: Executor, primaryLeaderDepth: number): Promise<HierarchyVerification> {
  const [row] = await queryRows<{
    missing: number;
    extra: number;
    wrong_depth: number;
    wrong_primary: number;
  }>(
    executor,
    sql`
    WITH RECURSIVE tree(ancestor_id, descendant_id, depth) AS (
      SELECT person_id, person_id, 0 FROM hierarchy_nodes
      UNION ALL
      SELECT t.ancestor_id, n.person_id, t.depth + 1
        FROM tree t JOIN hierarchy_nodes n ON n.parent_person_id = t.descendant_id
    ),
    expected_depth AS (
      SELECT descendant_id AS person_id, max(depth) AS depth FROM tree GROUP BY descendant_id
    )
    SELECT
      (SELECT count(*)::int FROM (SELECT ancestor_id, descendant_id, depth FROM tree
                                  EXCEPT SELECT ancestor_id, descendant_id, depth FROM hierarchy_closure) m) AS missing,
      (SELECT count(*)::int FROM (SELECT ancestor_id, descendant_id, depth FROM hierarchy_closure
                                  EXCEPT SELECT ancestor_id, descendant_id, depth FROM tree) x) AS extra,
      (SELECT count(*)::int FROM hierarchy_nodes n JOIN expected_depth e ON e.person_id = n.person_id
        WHERE n.depth <> e.depth) AS wrong_depth,
      (SELECT count(*)::int FROM hierarchy_nodes n
        WHERE n.primary_leader_person_id IS DISTINCT FROM (CASE
          WHEN n.depth < ${primaryLeaderDepth} THEN NULL
          WHEN n.depth = ${primaryLeaderDepth} THEN n.person_id
          ELSE (SELECT t.ancestor_id FROM tree t
                 WHERE t.descendant_id = n.person_id AND t.depth = n.depth - ${primaryLeaderDepth})
        END)) AS wrong_primary`,
  );
  return {
    missingClosureRows: Number(row?.missing ?? 0),
    extraClosureRows: Number(row?.extra ?? 0),
    wrongDepth: Number(row?.wrong_depth ?? 0),
    wrongPrimaryLeader: Number(row?.wrong_primary ?? 0),
  };
}

export function isConsistent(v: HierarchyVerification): boolean {
  return v.missingClosureRows + v.extraClosureRows + v.wrongDepth + v.wrongPrimaryLeader === 0;
}
