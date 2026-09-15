import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { LEADER_CHANGE_STATUSES } from '../../db/enums';
import { leaderChangeRequests, people, users } from '../../db/schema';
import { AppError, conflict, invalidState, notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, canAccessPerson, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { getSetting } from '../settings/settings.service';
import { getNode, isInSubtree, lockHierarchy, moveSubtree, writeHistory } from './hierarchy.core';

/**
 * Leader change requests (docs/01 BR-H-06, docs/05 W7b). Approval authority: the receiving
 * leader, or someone whose `hierarchy.requests.decide` scope covers both the person and the
 * receiving leader.
 */

export const RequestLeaderChangeInput = z.object({
  personId: z.uuid(),
  toLeaderId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function requestLeaderChange(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(RequestLeaderChangeInput, raw);
  assertPermission(ctx, 'people.view');

  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'people.view', input.personId);
    const node = await getNode(tx, input.personId);
    if (!node) throw invalidState('Place this person in the leadership structure first.');
    if (!(await getNode(tx, input.toLeaderId))) throw invalidState('The chosen leader is not in the leadership structure.');
    if (node.parentPersonId === input.toLeaderId) throw invalidState('This person is already in that group.');
    if (await isInSubtree(tx, input.personId, input.toLeaderId)) {
      throw new AppError('VALIDATION_ERROR', 'That would place this person under their own group.', {
        fieldErrors: { toLeaderId: ['Choose a leader who is not in this person’s group.'] },
      });
    }

    try {
      const [request] = await tx
        .insert(leaderChangeRequests)
        .values({
          personId: input.personId,
          fromLeaderPersonId: node.parentPersonId,
          toLeaderPersonId: input.toLeaderId,
          source: 'portal',
          requestedByUserId: actorUserId(ctx),
          reason: input.reason ?? null,
        })
        .returning({ id: leaderChangeRequests.id });
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'hierarchy.change_requested',
        entityType: 'person',
        entityId: input.personId,
        newValues: { fromLeaderId: node.parentPersonId, toLeaderId: input.toLeaderId },
        reason: input.reason ?? null,
      });
      return { requestId: request!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('There is already a pending leader change request for this person.');
      throw error;
    }
  });
}

export async function listLeaderChangeRequests(
  db: Executor,
  ctx: RequestContext,
  options: { status?: (typeof LEADER_CHANGE_STATUSES)[number] } = {},
) {
  assertPermission(ctx, 'people.view');
  const myPersonId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
  const person = alias(people, 'person');
  const fromLeader = alias(people, 'from_leader');
  const toLeader = alias(people, 'to_leader');

  const visible = sql`(
    ${myPersonId ? sql`${leaderChangeRequests.toLeaderPersonId} = ${myPersonId} OR ${leaderChangeRequests.fromLeaderPersonId} = ${myPersonId} OR` : sql``}
    ${personScopeFilter(ctx, 'hierarchy.requests.decide', leaderChangeRequests.personId)})`;

  const rows = await db
    .select({
      id: leaderChangeRequests.id,
      status: leaderChangeRequests.status,
      source: leaderChangeRequests.source,
      reason: leaderChangeRequests.reason,
      createdAt: leaderChangeRequests.createdAt,
      decidedAt: leaderChangeRequests.decidedAt,
      decisionNote: leaderChangeRequests.decisionNote,
      personId: person.id,
      personName: sql<string>`${person.firstName} || ' ' || ${person.lastName}`,
      fromLeaderId: fromLeader.id,
      fromLeaderName: sql<string | null>`${fromLeader.firstName} || ' ' || ${fromLeader.lastName}`,
      toLeaderId: toLeader.id,
      toLeaderName: sql<string>`${toLeader.firstName} || ' ' || ${toLeader.lastName}`,
      requestedBy: users.name,
      personViewable: sql<boolean>`${personScopeFilter(ctx, 'people.view', leaderChangeRequests.personId)}`,
      decidable: sql<boolean>`(${myPersonId ? sql`${leaderChangeRequests.toLeaderPersonId} = ${myPersonId} OR` : sql``}
        (${personScopeFilter(ctx, 'hierarchy.requests.decide', leaderChangeRequests.personId)}
         AND ${personScopeFilter(ctx, 'hierarchy.requests.decide', leaderChangeRequests.toLeaderPersonId)}))`,
    })
    .from(leaderChangeRequests)
    .innerJoin(person, eq(person.id, leaderChangeRequests.personId))
    .leftJoin(fromLeader, eq(fromLeader.id, leaderChangeRequests.fromLeaderPersonId))
    .innerJoin(toLeader, eq(toLeader.id, leaderChangeRequests.toLeaderPersonId))
    .leftJoin(users, eq(users.id, leaderChangeRequests.requestedByUserId))
    .where(and(eq(leaderChangeRequests.status, options.status ?? 'pending'), visible))
    .orderBy(desc(leaderChangeRequests.createdAt))
    .limit(200);

  return rows.map((r) => ({ ...r, incoming: r.toLeaderId === myPersonId }));
}

export const DecideLeaderChangeInput = z.object({
  requestId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});

export async function decideLeaderChangeRequest(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(DecideLeaderChangeInput, raw);
  if (ctx.actor.kind !== 'user') throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  const myPersonId = ctx.actor.personId;

  const outcome = await db.transaction(async (tx) => {
    await lockHierarchy(tx);
    const [request] = await tx
      .select()
      .from(leaderChangeRequests)
      .where(eq(leaderChangeRequests.id, input.requestId))
      .for('update');
    if (!request) throw notFound('request');

    const isReceivingLeader = myPersonId !== null && request.toLeaderPersonId === myPersonId;
    const canDecide =
      (await canAccessPerson(tx, ctx, 'hierarchy.requests.decide', request.personId)) &&
      (await canAccessPerson(tx, ctx, 'hierarchy.requests.decide', request.toLeaderPersonId));
    if (!isReceivingLeader && !canDecide) throw notFound('request');
    if (request.status !== 'pending') throw invalidState('This request has already been decided.');

    let status: 'approved' | 'rejected' | 'superseded' = input.decision === 'approve' ? 'approved' : 'rejected';

    if (input.decision === 'approve') {
      const node = await getNode(tx, request.personId);
      if (!node || node.parentPersonId !== request.fromLeaderPersonId) {
        status = 'superseded';
      } else {
        const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
        await moveSubtree(tx, { personId: request.personId, newParentPersonId: request.toLeaderPersonId, primaryLeaderDepth });
        await writeHistory(
          tx,
          [
            {
              personId: request.personId,
              previousLeaderPersonId: request.fromLeaderPersonId,
              newLeaderPersonId: request.toLeaderPersonId,
              changeType: 'moved',
              movedWithSubtree: true,
            },
          ],
          { operationId: newId(), changedBy: actorUserId(ctx), reason: input.note ?? request.reason, requestId: request.id, at: ctx.now },
        );
      }
    }

    await tx
      .update(leaderChangeRequests)
      .set({ status, decidedBy: actorUserId(ctx), decidedAt: ctx.now, decisionNote: input.note ?? null })
      .where(eq(leaderChangeRequests.id, request.id));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: `hierarchy.change_request_${status}`,
      entityType: 'person',
      entityId: request.personId,
      newValues: { requestId: request.id, toLeaderId: request.toLeaderPersonId, decidedAs: isReceivingLeader ? 'receiving_leader' : 'scope' },
      reason: input.note ?? null,
    });

    return { status };
  });

  // Raised only after the transaction commits, so the request really is closed as superseded.
  if (outcome.status === 'superseded') {
    throw conflict('This person’s leader changed after the request was made, so the request was closed.');
  }
  return outcome;
}
