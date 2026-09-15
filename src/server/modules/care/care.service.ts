import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import type { CARE_KINDS } from '../../db/enums';
import { careFollowups, journalEntries, people } from '../../db/schema';
import { notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, hasPermission, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { displayName } from '../people/people.queries';

/**
 * Care follow-ups (docs/03 §4.8, docs/05 W7). Generic across modules: the journal raises them
 * today; prayer and serving will later. Pastoral follow-ups are visible only with
 * care.pastoral.view; resolution notes only to pastoral viewers, the assignee and the author.
 */

const PAGE_SIZE = 50;
const OPEN_STATUSES = ['open', 'in_progress'] as const;
const CLOSED_STATUSES = ['resolved', 'dismissed'] as const;

export const CARE_KIND_LABELS: Record<(typeof CARE_KINDS)[number], string> = {
  journal_missed_streak: 'Daily journal',
  journal_flagged: 'Daily journal',
  prayer_unconfirmed: 'Prayer chain',
  serving_declined: 'Serving',
  registration_review: 'New registration',
  general: 'General',
};

function visibilityConditions(ctx: RequestContext): SQL[] {
  const conditions: SQL[] = [personScopeFilter(ctx, 'care.view', careFollowups.personId)];
  if (!hasPermission(ctx, 'care.pastoral.view')) conditions.push(eq(careFollowups.visibility, 'leadership'));
  return conditions;
}

export const FollowUpListInput = z.object({
  status: z.enum(['open', 'closed']).catch('open'),
  assigned: z.enum(['anyone', 'me', 'pastoral_pool']).catch('anyone'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export async function listFollowUps(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'care.view');
  const input = parseInput(FollowUpListInput, raw ?? {});
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
  const userId = actorUserId(ctx);
  const pastoral = hasPermission(ctx, 'care.pastoral.view');

  const conditions = visibilityConditions(ctx);
  conditions.push(inArray(careFollowups.status, input.status === 'open' ? [...OPEN_STATUSES] : [...CLOSED_STATUSES]));
  if (input.assigned === 'me') conditions.push(selfId ? eq(careFollowups.assignedToPersonId, selfId) : sql`FALSE`);
  if (input.assigned === 'pastoral_pool') conditions.push(isNull(careFollowups.assignedToPersonId));
  const where = and(...conditions)!;

  const assignee = alias(people, 'assignee');
  const rows = await db
    .select({
      id: careFollowups.id,
      personId: careFollowups.personId,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      kind: careFollowups.kind,
      summary: careFollowups.summary,
      status: careFollowups.status,
      visibility: careFollowups.visibility,
      assignedToPersonId: careFollowups.assignedToPersonId,
      assigneeFirstName: assignee.firstName,
      assigneeLastName: assignee.lastName,
      resolutionNote: careFollowups.resolutionNote,
      createdBy: careFollowups.createdBy,
      dueOn: careFollowups.dueOn,
      createdAt: careFollowups.createdAt,
      resolvedAt: careFollowups.resolvedAt,
      journalDate: journalEntries.journalDate,
    })
    .from(careFollowups)
    .innerJoin(people, eq(people.id, careFollowups.personId))
    .leftJoin(assignee, eq(assignee.id, careFollowups.assignedToPersonId))
    .leftJoin(
      journalEntries,
      sql`${careFollowups.sourceType} = 'journal_entry' AND ${journalEntries.id}::text = ${careFollowups.sourceRef}`,
    )
    .where(where)
    // Open items: longest-waiting first. Closed items: most recently closed first.
    .orderBy(input.status === 'open' ? asc(careFollowups.createdAt) : desc(careFollowups.resolvedAt), asc(careFollowups.id))
    .limit(PAGE_SIZE)
    .offset((input.page - 1) * PAGE_SIZE);
  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(careFollowups)
    .where(where);

  return {
    items: rows.map((r) => {
      const canSeeNote = pastoral || (selfId !== null && r.assignedToPersonId === selfId) || (userId !== null && r.createdBy === userId);
      return {
        id: r.id,
        person: { id: r.personId, name: displayName(r) },
        kind: r.kind,
        kindLabel: CARE_KIND_LABELS[r.kind],
        summary: r.summary,
        status: r.status,
        visibility: r.visibility,
        assignedTo: r.assigneeFirstName ? `${r.assigneeFirstName} ${r.assigneeLastName}` : null,
        isMine: selfId !== null && r.assignedToPersonId === selfId,
        dueOn: r.dueOn,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        resolutionNote: canSeeNote ? r.resolutionNote : null,
        journalDate: r.journalDate,
      };
    }),
    total: count?.total ?? 0,
    page: input.page,
    pageSize: PAGE_SIZE,
    status: input.status,
    assigned: input.assigned,
  };
}

export const UpdateFollowUpInput = z.object({
  followUpId: z.uuid(),
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(1000).optional()),
  assignToMe: z.boolean().default(false),
});

export async function updateFollowUp(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdateFollowUpInput, raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(careFollowups).where(eq(careFollowups.id, input.followUpId)).for('update');
    if (!row) throw notFound('follow-up');
    if (row.visibility === 'pastoral' && !hasPermission(ctx, 'care.pastoral.view')) throw notFound('follow-up');
    await assertCanAccessPerson(tx, ctx, 'care.manage', row.personId);

    const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
    const closing = input.status === 'resolved' || input.status === 'dismissed';
    await tx
      .update(careFollowups)
      .set({
        status: input.status,
        resolutionNote: input.note ?? row.resolutionNote,
        resolvedBy: closing ? actorUserId(ctx) : null,
        resolvedAt: closing ? ctx.now : null,
        assignedToPersonId: input.assignToMe && selfId ? selfId : row.assignedToPersonId,
        updatedAt: ctx.now,
      })
      .where(eq(careFollowups.id, row.id));

    if (closing && (row.kind === 'journal_missed_streak' || row.kind === 'journal_flagged')) {
      // Clear the care marker on the ledger once no other journal follow-up remains open.
      await tx.execute(sql`
        UPDATE journal_days SET care_status = 'resolved', updated_at = now()
         WHERE person_id = ${row.personId}::uuid AND care_status = 'needs_follow_up'
           AND NOT EXISTS (
             SELECT 1 FROM care_followups f
              WHERE f.person_id = ${row.personId}::uuid AND f.id <> ${row.id}::uuid
                AND f.kind IN ('journal_missed_streak', 'journal_flagged')
                AND f.status IN ('open', 'in_progress'))`);
    }

    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'care.followup_updated',
      entityType: 'care_followup',
      entityId: row.id,
      oldValues: { status: row.status },
      // The note itself can be sensitive: record only that it changed.
      newValues: { status: input.status, noteChanged: input.note !== undefined, assignedToMe: input.assignToMe },
    });
    return { status: input.status };
  });
}

/** Counts for the dashboard and navigation. */
export async function countOpenFollowUps(db: Database, ctx: RequestContext) {
  if (!hasPermission(ctx, 'care.view')) return { open: 0, mine: 0 };
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
  const [row] = await db
    .select({
      open: sql<number>`count(*)`.mapWith(Number),
      mine: (selfId
        ? sql<number>`count(*) FILTER (WHERE ${careFollowups.assignedToPersonId} = ${selfId}::uuid)`
        : sql<number>`0`
      ).mapWith(Number),
    })
    .from(careFollowups)
    .where(and(...visibilityConditions(ctx), inArray(careFollowups.status, [...OPEN_STATUSES])));
  return row ?? { open: 0, mine: 0 };
}
