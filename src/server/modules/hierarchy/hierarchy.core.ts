import { and, count, eq, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import type { LeadershipChangeType } from '../../db/enums';
import { hierarchyClosure, hierarchyNodes, leadershipHistory } from '../../db/schema';
import { AppError, invalidState } from '../../errors';
import { markJournalLedgerDirty } from '../journal/ledger-dirty';

/**
 * Closure-table maintenance (docs/03 §3). These functions perform no authorisation and
 * must run inside a transaction that holds the hierarchy lock (`lockHierarchy`).
 * They are used by HierarchyService, the importer and the seed.
 */

const HIERARCHY_LOCK_KEY = 7201;

export interface HierarchyNode {
  personId: string;
  parentPersonId: string | null;
  depth: number;
  primaryLeaderPersonId: string | null;
  acceptsMembers: boolean;
}

/** Serialises all hierarchy writes; released automatically at commit/rollback. */
export async function lockHierarchy(tx: Executor): Promise<void> {
  await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${HIERARCHY_LOCK_KEY})`));
}

export async function getNode(tx: Executor, personId: string): Promise<HierarchyNode | null> {
  const [row] = await tx
    .select({
      personId: hierarchyNodes.personId,
      parentPersonId: hierarchyNodes.parentPersonId,
      depth: hierarchyNodes.depth,
      primaryLeaderPersonId: hierarchyNodes.primaryLeaderPersonId,
      acceptsMembers: hierarchyNodes.acceptsMembers,
    })
    .from(hierarchyNodes)
    .where(eq(hierarchyNodes.personId, personId));
  return row ?? null;
}

/** True when `candidateId` is `rootId` or anywhere beneath it. */
export async function isInSubtree(tx: Executor, rootId: string, candidateId: string): Promise<boolean> {
  const [row] = await tx
    .select({ depth: hierarchyClosure.depth })
    .from(hierarchyClosure)
    .where(and(eq(hierarchyClosure.ancestorId, rootId), eq(hierarchyClosure.descendantId, candidateId)))
    .limit(1);
  return row !== undefined;
}

export async function childIds(tx: Executor, personId: string): Promise<string[]> {
  const rows = await tx
    .select({ personId: hierarchyNodes.personId })
    .from(hierarchyNodes)
    .where(eq(hierarchyNodes.parentPersonId, personId));
  return rows.map((r) => r.personId);
}

/** Number of people in the sub-tree, including its root. */
export async function subtreeSize(tx: Executor, personId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(hierarchyClosure)
    .where(eq(hierarchyClosure.ancestorId, personId));
  return row?.n ?? 0;
}

/**
 * Recomputes `primary_leader_person_id` for a sub-tree (or the whole tree when rootId is null):
 * the ancestor at the configured primary depth; self when at that depth; NULL when shallower.
 */
export async function refreshPrimaryLeaders(
  tx: Executor,
  primaryLeaderDepth: number,
  rootId: string | null = null,
): Promise<void> {
  const scope =
    rootId === null
      ? sql``
      : sql`WHERE n.person_id IN (SELECT descendant_id FROM hierarchy_closure WHERE ancestor_id = ${rootId}::uuid)`;
  await tx.execute(sql`
    UPDATE hierarchy_nodes n SET primary_leader_person_id = CASE
        WHEN n.depth < ${primaryLeaderDepth} THEN NULL
        WHEN n.depth = ${primaryLeaderDepth} THEN n.person_id
        ELSE (SELECT c.ancestor_id FROM hierarchy_closure c
              WHERE c.descendant_id = n.person_id AND c.depth = n.depth - ${primaryLeaderDepth})
      END
    ${scope}`);
}

/** Adds an unplaced person as a leaf under `parentPersonId` (or as a root when null). */
export async function insertNode(
  tx: Executor,
  input: { personId: string; parentPersonId: string | null; primaryLeaderDepth: number; acceptsMembers?: boolean },
): Promise<HierarchyNode> {
  if (await getNode(tx, input.personId)) throw invalidState('This person is already in the leadership structure.');

  let depth = 0;
  if (input.parentPersonId) {
    const parent = await getNode(tx, input.parentPersonId);
    if (!parent) throw invalidState('The selected leader is not in the leadership structure yet.');
    depth = parent.depth + 1;
  }

  await tx.insert(hierarchyNodes).values({
    personId: input.personId,
    parentPersonId: input.parentPersonId,
    depth,
    acceptsMembers: input.acceptsMembers ?? false,
  });
  await tx.execute(sql`
    INSERT INTO hierarchy_closure (ancestor_id, descendant_id, depth)
    SELECT ancestor_id, ${input.personId}::uuid, depth + 1
      FROM hierarchy_closure WHERE descendant_id = ${input.parentPersonId}::uuid
    UNION ALL
    SELECT ${input.personId}::uuid, ${input.personId}::uuid, 0`);
  await refreshPrimaryLeaders(tx, input.primaryLeaderDepth, input.personId);
  await markJournalLedgerDirty(tx);

  return (await getNode(tx, input.personId))!;
}

/** Moves a person and their whole sub-tree under a new leader (or makes them a root). */
export async function moveSubtree(
  tx: Executor,
  input: { personId: string; newParentPersonId: string | null; primaryLeaderDepth: number },
): Promise<void> {
  const { personId, newParentPersonId } = input;
  const node = await getNode(tx, personId);
  if (!node) throw invalidState('This person is not in the leadership structure.');

  let newDepth = 0;
  if (newParentPersonId) {
    const parent = await getNode(tx, newParentPersonId);
    if (!parent) throw invalidState('The selected leader is not in the leadership structure yet.');
    // BR-H-02: nobody can end up under their own group.
    if (await isInSubtree(tx, personId, newParentPersonId)) {
      throw new AppError('VALIDATION_ERROR', 'That would place this person under their own group.', {
        fieldErrors: { newLeaderId: ['Choose a leader who is not in this person’s group.'] },
      });
    }
    newDepth = parent.depth + 1;
  }

  // 1. Detach the sub-tree from its old ancestors.
  await tx.execute(sql`
    DELETE FROM hierarchy_closure c
     USING hierarchy_closure sub, hierarchy_closure sup
     WHERE sub.ancestor_id = ${personId}::uuid AND c.descendant_id = sub.descendant_id
       AND sup.descendant_id = ${personId}::uuid AND sup.ancestor_id <> ${personId}::uuid
       AND c.ancestor_id = sup.ancestor_id`);

  // 2. Attach it under the new parent's ancestors (including the new parent).
  if (newParentPersonId) {
    await tx.execute(sql`
      INSERT INTO hierarchy_closure (ancestor_id, descendant_id, depth)
      SELECT sup.ancestor_id, sub.descendant_id, sup.depth + sub.depth + 1
        FROM hierarchy_closure sup
        JOIN hierarchy_closure sub ON sub.ancestor_id = ${personId}::uuid
       WHERE sup.descendant_id = ${newParentPersonId}::uuid`);
  }

  // 3. Adjacency and depth in one statement (keeps the root/depth CHECK satisfied).
  await tx.execute(sql`
    UPDATE hierarchy_nodes n SET
        depth = sub.depth + ${newDepth},
        parent_person_id = CASE WHEN n.person_id = ${personId}::uuid
                                THEN ${newParentPersonId}::uuid ELSE n.parent_person_id END,
        updated_at = now()
      FROM hierarchy_closure sub
     WHERE sub.ancestor_id = ${personId}::uuid AND sub.descendant_id = n.person_id`);

  // 4. Primary leader for everyone who moved.
  await refreshPrimaryLeaders(tx, input.primaryLeaderDepth, personId);
  // 5. Journal ledger snapshots for open days follow the move (BR-H-05).
  await markJournalLedgerDirty(tx);
}

/** Removes a person with no direct group from the tree (closure rows cascade). */
export async function deleteLeafNode(tx: Executor, personId: string): Promise<void> {
  if ((await childIds(tx, personId)).length > 0) {
    throw invalidState('This person still leads a group. Reassign their group first.', {
      reason: 'HAS_DIRECT_GROUP',
    });
  }
  await tx.delete(hierarchyNodes).where(eq(hierarchyNodes.personId, personId));
  await markJournalLedgerDirty(tx);
}

export interface HistoryRow {
  personId: string;
  previousLeaderPersonId: string | null;
  newLeaderPersonId: string | null;
  changeType: LeadershipChangeType;
  movedWithSubtree?: boolean;
}

export async function writeHistory(
  tx: Executor,
  rows: HistoryRow[],
  meta: { operationId: string; changedBy: string | null; reason?: string | null; requestId?: string | null; at: Date },
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(leadershipHistory).values(
    rows.map((r) => ({
      personId: r.personId,
      previousLeaderPersonId: r.previousLeaderPersonId,
      newLeaderPersonId: r.newLeaderPersonId,
      changeType: r.changeType,
      movedWithSubtree: r.movedWithSubtree ?? false,
      effectiveAt: meta.at,
      reason: meta.reason ?? null,
      requestId: meta.requestId ?? null,
      operationId: meta.operationId,
      changedBy: meta.changedBy,
    })),
  );
}
