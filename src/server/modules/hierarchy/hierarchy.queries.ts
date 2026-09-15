import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import type { Executor } from '../../db/client';
import { qualified } from '../../db/sql-helpers';
import { hierarchyClosure, hierarchyNodes, leadershipLevels, people } from '../../db/schema';
import { notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, grantsFor, hasGlobal, personScopeFilter } from '../../policy/can';

/** Lazy-loaded leadership tree for the explorer (docs/04 A8). */

export interface TreeNode {
  personId: string;
  personCode: string;
  name: string;
  depth: number;
  levelName: string | null;
  status: 'active' | 'inactive';
  acceptsMembers: boolean;
  /** Direct group members the viewer is allowed to see. */
  visibleChildren: number;
  /** Everyone beneath this person (for context; counts are not personal data). */
  branchSize: number;
}

function nodeQuery(db: Executor, ctx: RequestContext, where: SQL | undefined) {
  return db
    .select({
      personId: hierarchyNodes.personId,
      personCode: people.personCode,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      status: people.status,
      depth: hierarchyNodes.depth,
      acceptsMembers: hierarchyNodes.acceptsMembers,
      levelName: leadershipLevels.name,
      visibleChildren: sql<number>`(SELECT count(*)::int FROM hierarchy_nodes c
        WHERE c.parent_person_id = ${qualified(hierarchyNodes.personId)}
          AND ${personScopeFilter(ctx, 'hierarchy.view', sql`c.person_id`)})`,
      branchSize: sql<number>`(SELECT greatest(count(*) - 1, 0)::int FROM hierarchy_closure hc
        WHERE hc.ancestor_id = ${qualified(hierarchyNodes.personId)})`,
    })
    .from(hierarchyNodes)
    .innerJoin(people, eq(people.id, hierarchyNodes.personId))
    .leftJoin(leadershipLevels, eq(leadershipLevels.depth, hierarchyNodes.depth))
    .where(where)
    .orderBy(asc(people.lastName), asc(people.firstName));
}

const toTreeNode = (r: Awaited<ReturnType<typeof nodeQuery>>[number]): TreeNode => ({
  personId: r.personId,
  personCode: r.personCode,
  name: r.preferredName && r.preferredName !== r.firstName ? `${r.firstName} (${r.preferredName}) ${r.lastName}` : `${r.firstName} ${r.lastName}`,
  depth: r.depth,
  levelName: r.levelName,
  status: r.status,
  acceptsMembers: r.acceptsMembers,
  visibleChildren: r.visibleChildren,
  branchSize: r.branchSize,
});

/** Starting points: tree roots for global viewers, the anchors of branch grants otherwise. */
export async function listTreeRoots(db: Executor, ctx: RequestContext): Promise<TreeNode[]> {
  assertPermission(ctx, 'hierarchy.view');
  if (hasGlobal(ctx, 'hierarchy.view')) {
    return (await nodeQuery(db, ctx, isNull(hierarchyNodes.parentPersonId))).map(toTreeNode);
  }
  const anchors = [
    ...new Set(
      grantsFor(ctx, 'hierarchy.view').flatMap((g) => (g.scope.type === 'branch' ? [g.scope.anchorPersonId] : [])),
    ),
  ];
  if (anchors.length === 0) return [];
  return (await nodeQuery(db, ctx, inArray(hierarchyNodes.personId, anchors))).map(toTreeNode);
}

export async function listTreeChildren(db: Executor, ctx: RequestContext, parentId: string): Promise<TreeNode[]> {
  assertPermission(ctx, 'hierarchy.view');
  if (!z.uuid().safeParse(parentId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'hierarchy.view', parentId);
  const rows = await nodeQuery(
    db,
    ctx,
    and(eq(hierarchyNodes.parentPersonId, parentId), personScopeFilter(ctx, 'hierarchy.view', hierarchyNodes.personId)),
  );
  return rows.map(toTreeNode);
}

/**
 * Ancestor ids from the top of the viewer's visible tree down to the person (inclusive),
 * so the explorer can expand straight to a search result.
 */
export async function getVisiblePath(db: Executor, ctx: RequestContext, personId: string): Promise<string[]> {
  assertPermission(ctx, 'hierarchy.view');
  if (!z.uuid().safeParse(personId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'hierarchy.view', personId);
  const rows = await db
    .select({ id: hierarchyClosure.ancestorId })
    .from(hierarchyClosure)
    .where(
      and(
        eq(hierarchyClosure.descendantId, personId),
        gte(hierarchyClosure.depth, 0),
        personScopeFilter(ctx, 'hierarchy.view', hierarchyClosure.ancestorId),
      ),
    )
    .orderBy(desc(hierarchyClosure.depth));
  return rows.map((r) => r.id);
}
