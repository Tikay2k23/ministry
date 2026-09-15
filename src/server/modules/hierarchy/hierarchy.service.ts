import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Transaction } from '../../db/client';
import { hierarchyNodes, people } from '../../db/schema';
import { AppError, conflict, invalidState, notFound } from '../../errors';
import { assertCanAccessPerson, assertGlobal, assertPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { getSetting } from '../settings/settings.service';
import {
  childIds,
  deleteLeafNode,
  getNode,
  insertNode,
  isInSubtree,
  lockHierarchy,
  moveSubtree,
  subtreeSize,
  writeHistory,
  type HistoryRow,
} from './hierarchy.core';

/**
 * Leadership hierarchy use-cases with authorisation, history and audit (docs/05 W7, W15).
 * Every write takes the hierarchy advisory lock. `*InTx` variants let other modules
 * (people creation, import) compose these operations inside their own transaction.
 */

const uuid = z.uuid();
const reason = z.string().trim().max(500).optional();

async function assertActivePerson(tx: Transaction, personId: string): Promise<void> {
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), isNull(people.archivedAt)));
  if (!row) throw notFound('person');
}

/** A new leader must be within the actor's `hierarchy.manage` scope; roots need global rights. */
async function assertCanPlaceUnder(tx: Transaction, ctx: RequestContext, leaderId: string | null): Promise<void> {
  if (leaderId === null) assertGlobal(ctx, 'hierarchy.manage');
  else await assertCanAccessPerson(tx, ctx, 'hierarchy.manage', leaderId);
}

// ─── Place ────────────────────────────────────────────────────────────────────

export const PlaceInput = z.object({
  personId: uuid,
  leaderId: uuid.nullable(),
  acceptsMembers: z.boolean().optional(),
  reason,
});

export async function placePersonInTx(tx: Transaction, ctx: RequestContext, raw: unknown) {
  const input = parseInput(PlaceInput, raw);
  assertPermission(ctx, 'hierarchy.manage');
  await lockHierarchy(tx);
  await assertActivePerson(tx, input.personId);
  await assertCanPlaceUnder(tx, ctx, input.leaderId);
  if (input.leaderId) await assertActivePerson(tx, input.leaderId);

  const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
  const node = await insertNode(tx, {
    personId: input.personId,
    parentPersonId: input.leaderId,
    primaryLeaderDepth,
    acceptsMembers: input.acceptsMembers,
  });

  const operationId = newId();
  await writeHistory(
    tx,
    [{ personId: input.personId, previousLeaderPersonId: null, newLeaderPersonId: input.leaderId, changeType: 'placed' }],
    { operationId, changedBy: actorUserId(ctx), reason: input.reason, at: ctx.now },
  );
  await recordAudit(tx, ctx, {
    category: 'change',
    action: 'hierarchy.placed',
    entityType: 'person',
    entityId: input.personId,
    newValues: { leaderId: input.leaderId },
    reason: input.reason,
  });
  return { operationId, node };
}

export function placePerson(db: Database, ctx: RequestContext, input: unknown) {
  return db.transaction((tx) => placePersonInTx(tx, ctx, input));
}

/**
 * Places a person the caller has just created. Performs NO authorisation: creating someone
 * within your own scope implies placing them there, so the calling service authorises
 * (e.g. PeopleService checks `people.create` on the leader).
 */
export async function placeNewPersonInTx(
  tx: Transaction,
  ctx: RequestContext,
  input: { personId: string; leaderId: string | null; acceptsMembers?: boolean; operationId?: string; reason?: string },
) {
  await lockHierarchy(tx);
  const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
  const node = await insertNode(tx, {
    personId: input.personId,
    parentPersonId: input.leaderId,
    primaryLeaderDepth,
    acceptsMembers: input.acceptsMembers,
  });
  await writeHistory(
    tx,
    [{ personId: input.personId, previousLeaderPersonId: null, newLeaderPersonId: input.leaderId, changeType: 'placed' }],
    { operationId: input.operationId ?? newId(), changedBy: actorUserId(ctx), reason: input.reason, at: ctx.now },
  );
  return node;
}

// ─── Move ─────────────────────────────────────────────────────────────────────

export const MoveInput = z
  .object({
    personId: uuid,
    newLeaderId: uuid.nullable(),
    mode: z.enum(['with_subtree', 'leave_group']).default('with_subtree'),
    /** Required for mode = leave_group: who receives this person's direct group. */
    groupNewLeaderId: uuid.optional(),
    reason,
    /** Optimistic concurrency: the leader the actor saw. */
    expectedLeaderId: uuid.nullable().optional(),
  })
  .refine((v) => v.mode !== 'leave_group' || v.groupNewLeaderId, {
    path: ['groupNewLeaderId'],
    message: 'Choose who will lead this person’s group.',
  });

export async function movePersonInTx(tx: Transaction, ctx: RequestContext, raw: unknown) {
  const input = parseInput(MoveInput, raw);
  assertPermission(ctx, 'hierarchy.manage');
  await lockHierarchy(tx);

  const node = await getNode(tx, input.personId);
  if (!node) throw notFound('person');
  await assertCanAccessPerson(tx, ctx, 'hierarchy.manage', input.personId);
  await assertCanPlaceUnder(tx, ctx, input.newLeaderId);
  if (input.newLeaderId) await assertActivePerson(tx, input.newLeaderId);

  if (input.expectedLeaderId !== undefined && input.expectedLeaderId !== node.parentPersonId) {
    throw conflict('Someone else changed this person’s leader. Please reload and try again.', {
      currentLeaderId: node.parentPersonId,
    });
  }
  if (input.newLeaderId === node.parentPersonId) {
    throw invalidState('This person is already in that group.');
  }

  const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
  const history: HistoryRow[] = [];
  const children = await childIds(tx, input.personId);

  if (input.mode === 'leave_group' && children.length > 0) {
    const groupLeaderId = input.groupNewLeaderId!;
    await assertCanPlaceUnder(tx, ctx, groupLeaderId);
    if (!(await getNode(tx, groupLeaderId))) throw invalidState('The selected leader is not in the leadership structure yet.');
    if (await isInSubtree(tx, input.personId, groupLeaderId)) {
      throw new AppError('VALIDATION_ERROR', 'Choose a leader outside this person’s group.', {
        fieldErrors: { groupNewLeaderId: ['Choose a leader outside this person’s group.'] },
      });
    }
    for (const childId of children) {
      await moveSubtree(tx, { personId: childId, newParentPersonId: groupLeaderId, primaryLeaderDepth });
      history.push({
        personId: childId,
        previousLeaderPersonId: input.personId,
        newLeaderPersonId: groupLeaderId,
        changeType: 'group_reassigned',
        movedWithSubtree: true,
      });
    }
  }

  const movedCount = await subtreeSize(tx, input.personId);
  await moveSubtree(tx, { personId: input.personId, newParentPersonId: input.newLeaderId, primaryLeaderDepth });
  history.push({
    personId: input.personId,
    previousLeaderPersonId: node.parentPersonId,
    newLeaderPersonId: input.newLeaderId,
    changeType: 'moved',
    movedWithSubtree: movedCount > 1,
  });

  const operationId = newId();
  await writeHistory(tx, history, { operationId, changedBy: actorUserId(ctx), reason: input.reason, at: ctx.now });
  await recordAudit(tx, ctx, {
    category: 'change',
    action: 'hierarchy.moved',
    entityType: 'person',
    entityId: input.personId,
    oldValues: { leaderId: node.parentPersonId },
    newValues: { leaderId: input.newLeaderId, mode: input.mode, groupNewLeaderId: input.groupNewLeaderId ?? null },
    reason: input.reason,
  });
  // M2: re-snapshot unfinalised journal ledger rows for the moved people (BR-H-05).
  return { operationId, movedCount };
}

export function movePerson(db: Database, ctx: RequestContext, input: unknown) {
  return db.transaction((tx) => movePersonInTx(tx, ctx, input));
}

// ─── Reassign a whole direct group (leader deactivation wizard) ──────────────

export const ReassignGroupInput = z.object({
  fromLeaderId: uuid,
  assignments: z.array(z.object({ personId: uuid, newLeaderId: uuid })).min(1).max(500),
  reason,
});

export function reassignGroup(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ReassignGroupInput, raw);
  return db.transaction(async (tx) => {
    const current = new Set(await childIds(tx, input.fromLeaderId));
    for (const a of input.assignments) {
      if (!current.has(a.personId)) throw invalidState('Someone in this list is no longer in that group. Please reload.');
    }
    const results = [];
    for (const a of input.assignments) {
      results.push(
        await movePersonInTx(tx, ctx, {
          personId: a.personId,
          newLeaderId: a.newLeaderId,
          expectedLeaderId: input.fromLeaderId,
          reason: input.reason,
        }),
      );
    }
    return { moved: results.length };
  });
}

// ─── Remove / flags ───────────────────────────────────────────────────────────

export const RemoveInput = z.object({ personId: uuid, reason });

export function removeFromHierarchy(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(RemoveInput, raw);
  assertPermission(ctx, 'hierarchy.manage');
  return db.transaction(async (tx) => {
    await lockHierarchy(tx);
    const node = await getNode(tx, input.personId);
    if (!node) throw notFound('person');
    await assertCanAccessPerson(tx, ctx, 'hierarchy.manage', input.personId);
    await deleteLeafNode(tx, input.personId);
    const operationId = newId();
    await writeHistory(
      tx,
      [{ personId: input.personId, previousLeaderPersonId: node.parentPersonId, newLeaderPersonId: null, changeType: 'removed' }],
      { operationId, changedBy: actorUserId(ctx), reason: input.reason, at: ctx.now },
    );
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'hierarchy.removed',
      entityType: 'person',
      entityId: input.personId,
      oldValues: { leaderId: node.parentPersonId },
      reason: input.reason,
    });
    return { operationId };
  });
}

export const AcceptsMembersInput = z.object({ personId: uuid, acceptsMembers: z.boolean() });

export function setAcceptsMembers(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AcceptsMembersInput, raw);
  assertPermission(ctx, 'hierarchy.manage');
  return db.transaction(async (tx) => {
    const node = await getNode(tx, input.personId);
    if (!node) throw notFound('person');
    await assertCanAccessPerson(tx, ctx, 'hierarchy.manage', input.personId);
    await tx
      .update(hierarchyNodes)
      .set({ acceptsMembers: input.acceptsMembers, updatedAt: ctx.now })
      .where(eq(hierarchyNodes.personId, input.personId));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'hierarchy.accepts_members_changed',
      entityType: 'person',
      entityId: input.personId,
      oldValues: { acceptsMembers: node.acceptsMembers },
      newValues: { acceptsMembers: input.acceptsMembers },
    });
  });
}
