import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { formatPhone } from '@/lib/phone';
import { formatSlotRange } from '@/lib/time-range';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import { qualified } from '../../db/sql-helpers';
import { formAnswerSets, formResponses, people, prayerAssignments, prayerSlots } from '../../db/schema';
import { conflict, invalidState, notFound, validationError } from '../../errors';
import { canAccessChain, hasGlobal, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import type { AnswerValue } from '../forms/answers';
import { getFormVersion } from '../forms/forms.service';
import { addDays } from '../journal/journal-dates';
import { queueNotification } from '../notifications/notifications.service';
import { displayName } from '../people/people.queries';
import { getSetting } from '../settings/settings.service';
import { issuePrayerActionLink, revokeAssignmentLinks } from './action-links.service';
import { actorFromContext, chainForActor, chainToday, closePrayerFollowUp, optionalText, recordPrayerEvent, type ChainRow } from './common';
import { HOLDS_PLACE, PLACEMENT_MESSAGES, placeAssignment } from './placement';

/**
 * The coordinator's side of a chain (docs/04 A17, docs/05 W11, W13, W14): the day board, manual
 * assignment, substitutes, gentle follow-up resolution, share links and reports.
 */

/** People shown on a slot: everyone except those replaced or removed. */
const ON_SLOT = ['scheduled', 'confirmed', 'in_prayer', 'completed', 'needs_follow_up', 'missed', 'excused'] as const;

const holdsPlace = (status: string) => (HOLDS_PLACE as readonly string[]).includes(status);

async function assignmentForPortal(executor: Executor, assignmentId: string, options: { forUpdate?: boolean } = {}) {
  if (!z.uuid().safeParse(assignmentId).success) throw notFound('prayer slot');
  const query = executor
    .select({
      id: prayerAssignments.id,
      slotId: prayerAssignments.slotId,
      personId: prayerAssignments.personId,
      status: prayerAssignments.status,
      startsAt: prayerAssignments.startsAt,
      endsAt: prayerAssignments.endsAt,
      completedLate: prayerAssignments.completedLate,
      verifiedByCoordinator: prayerAssignments.verifiedByCoordinator,
      reportResponseId: prayerAssignments.reportResponseId,
      chainId: prayerSlots.prayerChainId,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
    })
    .from(prayerAssignments)
    .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
    .innerJoin(people, eq(people.id, prayerAssignments.personId))
    .where(eq(prayerAssignments.id, assignmentId));
  const [row] = options.forUpdate ? await query.for('update', { of: prayerAssignments }) : await query;
  if (!row) throw notFound('prayer slot');
  return row;
}

/** Tells the person about a new slot, with a personal link added at send time. Paused chains send nothing. */
async function notifyAssigned(executor: Executor, chain: ChainRow, assignmentId: string) {
  if (chain.status !== 'active') return;
  const [row] = await executor
    .select({ personId: prayerAssignments.personId, startsAt: prayerAssignments.startsAt, endsAt: prayerAssignments.endsAt })
    .from(prayerAssignments)
    .where(eq(prayerAssignments.id, assignmentId));
  if (!row) return;
  await queueNotification(executor, {
    templateKey: 'prayer.assigned',
    recipientPersonId: row.personId,
    payload: { chainName: chain.name, slotLabel: formatSlotRange(row.startsAt, row.endsAt, chain.timezone, { withDate: true }), assignmentId },
    dedupeKey: `prayer_assigned:${assignmentId}`,
  });
}

// ─── The day board ────────────────────────────────────────────────────────────

export const BoardInput = z.object({ chainId: z.uuid(), date: z.iso.date().optional() });

export async function getChainBoard(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(BoardInput, raw);
  const chain = await chainForActor(db, ctx, 'prayer.view', input.chainId);
  const today = chainToday(chain, ctx.now);
  const date = input.date ?? today;
  const ref = { id: chain.id, ministryId: chain.ministryId };
  const pastoral = hasGlobal(ctx, 'prayer.requests.confidential.view');
  const can = {
    assign: canAccessChain(ctx, 'prayer.assign', ref),
    resolve: canAccessChain(ctx, 'prayer.resolve', ref),
    viewReports: canAccessChain(ctx, 'prayer.reports.view', ref),
    manage: canAccessChain(ctx, 'prayer.manage', ref),
  };

  const slots = await db
    .select({ id: prayerSlots.id, startsAt: prayerSlots.startsAt, endsAt: prayerSlots.endsAt, capacity: prayerSlots.capacity })
    .from(prayerSlots)
    .where(and(eq(prayerSlots.prayerChainId, chain.id), eq(prayerSlots.chainDate, date), eq(prayerSlots.status, 'open')))
    .orderBy(asc(prayerSlots.startsAt));
  const assigned =
    slots.length === 0
      ? []
      : await db
          .select({
            id: prayerAssignments.id,
            slotId: prayerAssignments.slotId,
            personId: prayerAssignments.personId,
            status: prayerAssignments.status,
            completedLate: prayerAssignments.completedLate,
            verified: prayerAssignments.verifiedByCoordinator,
            cannotMakeItAt: prayerAssignments.cannotMakeItAt,
            source: prayerAssignments.source,
            reportAnonymous: formResponses.isAnonymous,
            firstName: people.firstName,
            lastName: people.lastName,
            preferredName: people.preferredName,
          })
          .from(prayerAssignments)
          .innerJoin(people, eq(people.id, prayerAssignments.personId))
          .leftJoin(formResponses, eq(formResponses.id, prayerAssignments.reportResponseId))
          .where(and(inArray(prayerAssignments.slotId, slots.map((s) => s.id)), inArray(prayerAssignments.status, [...ON_SLOT])))
          .orderBy(asc(prayerAssignments.createdAt));

  const nowMs = ctx.now.getTime();
  const board = slots.map((slot) => {
    const onSlot = assigned
      .filter((a) => a.slotId === slot.id)
      .map((a) => ({
        id: a.id,
        personId: a.personId,
        name: displayName(a),
        status: a.status,
        completedLate: a.completedLate,
        verified: a.verified,
        cannotMakeIt: a.cannotMakeItAt !== null,
        substitute: a.source === 'substitute',
        // An anonymous report is never tied to its author for anyone but the pastoral team (docs/06 note h).
        hasReport: can.viewReports && a.reportAnonymous !== null && (!a.reportAnonymous || pastoral),
      }));
    const taken = onSlot.filter((a) => holdsPlace(a.status)).length;
    return {
      id: slot.id,
      label: formatSlotRange(slot.startsAt, slot.endsAt, chain.timezone),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      capacity: slot.capacity,
      isNow: slot.startsAt.getTime() <= nowMs && nowMs < slot.endsAt.getTime(),
      isPast: slot.endsAt.getTime() <= nowMs,
      placesLeft: Math.max(0, slot.capacity - taken),
      assignments: onSlot,
    };
  });

  const { defaultCountry } = await getSetting(db, 'ministry.profile');
  const phone = sql<string | null>`CASE WHEN ${personScopeFilter(ctx, 'people.contact.view', qualified(people.id))} THEN ${people.phoneE164} END`;
  const listFields = {
    id: prayerAssignments.id,
    startsAt: prayerAssignments.startsAt,
    endsAt: prayerAssignments.endsAt,
    checkedInAt: prayerAssignments.checkedInAt,
    firstName: people.firstName,
    lastName: people.lastName,
    preferredName: people.preferredName,
    phone,
  };
  const [followUps, needsSubstitute] = await Promise.all([
    db
      .select(listFields)
      .from(prayerAssignments)
      .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
      .innerJoin(people, eq(people.id, prayerAssignments.personId))
      .where(and(eq(prayerSlots.prayerChainId, chain.id), eq(prayerAssignments.status, 'needs_follow_up')))
      .orderBy(asc(prayerAssignments.endsAt))
      .limit(50),
    db
      .select(listFields)
      .from(prayerAssignments)
      .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
      .innerJoin(people, eq(people.id, prayerAssignments.personId))
      .where(
        and(
          eq(prayerSlots.prayerChainId, chain.id),
          inArray(prayerAssignments.status, ['scheduled', 'confirmed']),
          isNotNull(prayerAssignments.cannotMakeItAt),
          gt(prayerAssignments.startsAt, ctx.now),
        ),
      )
      .orderBy(asc(prayerAssignments.startsAt))
      .limit(50),
  ]);
  const toItem = (row: (typeof followUps)[number]) => ({
    assignmentId: row.id,
    name: displayName(row),
    slotLabel: formatSlotRange(row.startsAt, row.endsAt, chain.timezone, { withDate: true }),
    phone: row.phone ? formatPhone(row.phone, defaultCountry) : null,
    checkedIn: row.checkedInAt !== null,
  });

  return {
    chain: { id: chain.id, name: chain.name, status: chain.status, timezone: chain.timezone, chainType: chain.chainType },
    date,
    today,
    previousDate: addDays(date, -1),
    nextDate: addDays(date, 1),
    slots: board,
    summary: {
      slots: board.length,
      covered: board.filter((s) => s.assignments.some((a) => holdsPlace(a.status))).length,
      completed: board.filter((s) => s.assignments.some((a) => a.status === 'completed')).length,
      gaps: board.filter((s) => !s.isPast && s.placesLeft > 0).length,
    },
    followUps: followUps.map(toItem),
    needsSubstitute: needsSubstitute.map(toItem),
    can,
  };
}

// ─── Choosing people ──────────────────────────────────────────────────────────

export const AssignableSearchInput = z.object({ chainId: z.uuid(), q: z.string().trim().max(80).default('') });

/**
 * People a coordinator can put on a slot. Like the leader directory (docs/06 note j), this shows
 * names and person codes only, never contact details. People who already pray in this chain come
 * first; with fewer than two letters typed, only they are listed.
 */
export async function searchAssignablePeople(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AssignableSearchInput, raw);
  const chain = await chainForActor(db, ctx, 'prayer.assign', input.chainId);
  const inPool = sql`EXISTS (SELECT 1 FROM prayer_assignments pa JOIN prayer_slots ps ON ps.id = pa.slot_id
                             WHERE ps.prayer_chain_id = ${chain.id}::uuid AND pa.person_id = p.id)`;
  const q = input.q;
  const escaped = q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const matches =
    q.length < 2
      ? inPool
      : sql`(p.search_name % lower(immutable_unaccent(${q})) OR p.search_name LIKE lower(immutable_unaccent(${`%${escaped}%`})))`;
  const rows = await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null; person_code: string; in_pool: boolean }>(
    db,
    sql`SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.person_code, ${inPool} AS in_pool
          FROM people p
         WHERE p.archived_at IS NULL AND p.registration_status = 'confirmed' AND ${matches}
         ORDER BY in_pool DESC, p.last_name, p.first_name
         LIMIT 20`,
  );
  return rows.map((r) => ({
    personId: r.id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    personCode: r.person_code,
    inPool: r.in_pool,
  }));
}

/**
 * Substitute suggestions (docs/05 W14 step 2): people who pray in this chain, free at that time,
 * with the fewest slots in the last 30 days first.
 */
export async function suggestSubstitutes(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(z.object({ assignmentId: z.uuid() }), raw);
  const original = await assignmentForPortal(db, assignmentId);
  const chain = await chainForActor(db, ctx, 'prayer.assign', original.chainId);
  const nowMs = ctx.now.getTime();
  const rows = await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null; recent: number }>(
    db,
    sql`WITH pool AS (
          SELECT pa.person_id FROM prayer_assignments pa JOIN prayer_slots ps ON ps.id = pa.slot_id
           WHERE ps.prayer_chain_id = ${chain.id}::uuid AND pa.starts_at > ${new Date(nowMs - 90 * 86_400_000).toISOString()}::timestamptz
          UNION
          SELECT pc.person_id FROM prayer_commitments pc WHERE pc.prayer_chain_id = ${chain.id}::uuid AND pc.ended_at IS NULL
        )
        SELECT p.id, p.first_name, p.last_name, p.preferred_name,
               (SELECT count(*)::int FROM prayer_assignments r
                 WHERE r.person_id = p.id AND r.status NOT IN ('replaced', 'cancelled')
                   AND r.starts_at > ${new Date(nowMs - 30 * 86_400_000).toISOString()}::timestamptz) AS recent
          FROM people p
          JOIN pool ON pool.person_id = p.id
         WHERE p.archived_at IS NULL AND p.id <> ${original.personId}::uuid
           AND NOT EXISTS (
                 SELECT 1 FROM prayer_assignments o
                  WHERE o.person_id = p.id AND o.status NOT IN ('replaced', 'cancelled', 'excused')
                    AND tstzrange(o.starts_at, o.ends_at) && tstzrange(${original.startsAt.toISOString()}::timestamptz, ${original.endsAt.toISOString()}::timestamptz))
         ORDER BY recent ASC, p.last_name, p.first_name
         LIMIT 8`,
  );
  return rows.map((r) => ({
    personId: r.id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    recentSlots: Number(r.recent),
  }));
}

// ─── Assign, substitute, remove ───────────────────────────────────────────────

export const AssignInput = z.object({ slotId: z.uuid(), personId: z.uuid(), note: optionalText(500) });

export async function assignToSlot(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AssignInput, raw);
  return db.transaction(async (tx) => {
    const [slot] = await tx.select({ chainId: prayerSlots.prayerChainId }).from(prayerSlots).where(eq(prayerSlots.id, input.slotId));
    if (!slot) throw notFound('prayer slot');
    const chain = await chainForActor(tx, ctx, 'prayer.assign', slot.chainId);
    if (chain.status === 'ended') throw invalidState('This prayer chain has ended.');

    const placed = await placeAssignment(tx, {
      slotId: input.slotId,
      personId: input.personId,
      source: 'manual',
      createdBy: actorUserId(ctx),
      actor: actorFromContext(ctx),
      via: 'portal',
      now: ctx.now,
      note: input.note ?? null,
    });
    if (!placed.ok) throw conflict(PLACEMENT_MESSAGES[placed.reason], { reason: placed.reason });
    await notifyAssigned(tx, chain, placed.assignmentId);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.assigned',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { assignmentId: placed.assignmentId, slotId: input.slotId, personId: input.personId },
    });
    return { assignmentId: placed.assignmentId };
  });
}

export const SubstituteInput = z.object({ assignmentId: z.uuid(), substitutePersonId: z.uuid(), reason: optionalText(500) });

/**
 * Hands a slot to someone else (docs/05 W14 step 3–4). Before the slot starts, the original is
 * replaced — no mark against them — and their links stop working. After it has started, the
 * original stays for a normal follow-up and the substitute is added alongside.
 */
export async function substituteAssignment(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(SubstituteInput, raw);
  return db.transaction(async (tx) => {
    const original = await assignmentForPortal(tx, input.assignmentId, { forUpdate: true });
    const chain = await chainForActor(tx, ctx, 'prayer.assign', original.chainId);
    if (!['scheduled', 'confirmed', 'in_prayer', 'needs_follow_up'].includes(original.status)) {
      throw invalidState('Only a slot that isn’t finished or resolved can get a substitute.');
    }
    if (original.personId === input.substitutePersonId) {
      throw validationError({ substitutePersonId: ['Choose someone else as the substitute.'] });
    }

    const started = original.startsAt <= ctx.now;
    const actor = actorFromContext(ctx);
    if (!started) {
      await tx.update(prayerAssignments).set({ status: 'replaced', updatedAt: ctx.now }).where(eq(prayerAssignments.id, original.id));
      await revokeAssignmentLinks(tx, original.id, ctx.now);
    }
    const placed = await placeAssignment(tx, {
      slotId: original.slotId,
      personId: input.substitutePersonId,
      source: 'substitute',
      substituteForId: original.id,
      ignoreCapacity: started,
      createdBy: actorUserId(ctx),
      actor,
      via: 'portal',
      now: ctx.now,
      note: input.reason ?? null,
    });
    if (!placed.ok) throw conflict(PLACEMENT_MESSAGES[placed.reason], { reason: placed.reason });
    await recordPrayerEvent(tx, { assignmentId: original.id, eventType: 'substitute_assigned', actor, via: 'portal', at: ctx.now, note: input.reason ?? null });
    await notifyAssigned(tx, chain, placed.assignmentId);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.substituted',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { originalAssignmentId: original.id, substituteAssignmentId: placed.assignmentId, substitutePersonId: input.substitutePersonId, started },
    });
    return { substituteAssignmentId: placed.assignmentId, originalReplaced: !started };
  });
}

export const CancelAssignmentInput = z.object({ assignmentId: z.uuid(), reason: optionalText(500) });

/** Takes someone off an upcoming slot; their links stop working. */
export async function cancelAssignment(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CancelAssignmentInput, raw);
  return db.transaction(async (tx) => {
    const assignment = await assignmentForPortal(tx, input.assignmentId, { forUpdate: true });
    const chain = await chainForActor(tx, ctx, 'prayer.assign', assignment.chainId);
    if (!['scheduled', 'confirmed'].includes(assignment.status) || assignment.startsAt <= ctx.now) {
      throw invalidState('Only an upcoming slot can be removed. For a slot that has started, add a substitute or resolve it.');
    }
    await tx.update(prayerAssignments).set({ status: 'cancelled', updatedAt: ctx.now }).where(eq(prayerAssignments.id, assignment.id));
    await revokeAssignmentLinks(tx, assignment.id, ctx.now);
    await recordPrayerEvent(tx, { assignmentId: assignment.id, eventType: 'cancelled', actor: actorFromContext(ctx), via: 'portal', at: ctx.now, note: input.reason ?? null });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.assignment_removed',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { assignmentId: assignment.id, personId: assignment.personId },
    });
    return { cancelled: true as const };
  });
}

// ─── Follow-up (docs/05 W13 step 4) ───────────────────────────────────────────

export const ResolveInput = z.object({
  assignmentId: z.uuid(),
  outcome: z.enum(['completed_verified', 'missed', 'excused']),
  note: optionalText(1000),
});

/** Only a coordinator decides Missed or Excused (BR-PR-04); a late "finished" can also be confirmed as prayed. */
export async function resolveFollowUp(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ResolveInput, raw);
  return db.transaction(async (tx) => {
    const assignment = await assignmentForPortal(tx, input.assignmentId, { forUpdate: true });
    const chain = await chainForActor(tx, ctx, 'prayer.resolve', assignment.chainId);
    const unverifiedLate = assignment.status === 'completed' && assignment.completedLate && !assignment.verifiedByCoordinator;
    if (assignment.status !== 'needs_follow_up' && !(unverifiedLate && input.outcome === 'completed_verified')) {
      throw invalidState('Only a slot that needs follow-up can be resolved.');
    }

    const userId = actorUserId(ctx)!;
    const status = input.outcome === 'completed_verified' ? 'completed' : input.outcome;
    await tx
      .update(prayerAssignments)
      .set({
        status,
        ...(input.outcome === 'completed_verified' ? { verifiedByCoordinator: true } : {}),
        resolvedBy: userId,
        resolvedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(prayerAssignments.id, assignment.id));
    await recordPrayerEvent(tx, {
      assignmentId: assignment.id,
      eventType: input.outcome === 'completed_verified' ? 'resolved_completed' : input.outcome === 'missed' ? 'resolved_missed' : 'resolved_excused',
      actor: actorFromContext(ctx),
      via: 'portal',
      at: ctx.now,
      note: input.note ?? null,
    });
    await closePrayerFollowUp(tx, assignment.id, { note: input.note ?? null, resolvedBy: userId, now: ctx.now });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.follow_up_resolved',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { assignmentId: assignment.id, outcome: input.outcome },
    });
    return { status };
  });
}

// ─── Links and reports ────────────────────────────────────────────────────────

/** A fresh personal link for the coordinator to share by Messenger or Viber (docs/05 W11 "Links"). */
export async function shareAssignmentLink(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(z.object({ assignmentId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    const assignment = await assignmentForPortal(tx, assignmentId);
    const chain = await chainForActor(tx, ctx, 'prayer.assign', assignment.chainId);
    const link = await issuePrayerActionLink(tx, assignment.id, ctx.now, actorUserId(ctx));
    if (!link) throw invalidState('This slot is over or no longer active, so it has no link to share.');
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'prayer.link_shared',
      entityType: 'prayer_chain',
      entityId: chain.id,
      newValues: { assignmentId: assignment.id, expiresAt: link.expiresAt.toISOString() },
    });
    return {
      url: link.url,
      expiresAt: link.expiresAt,
      firstName: assignment.preferredName ?? assignment.firstName,
      chainName: chain.name,
      slotLabel: formatSlotRange(assignment.startsAt, assignment.endsAt, chain.timezone, { withDate: true }),
    };
  });
}

/**
 * A prayer report (docs/06 rows 27–28). Coordinators read reports and testimonies; confidential
 * prayer requests, and who wrote an anonymous report, are for the pastoral team only. Every read
 * is recorded in the access log.
 */
export async function getAssignmentReport(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(z.object({ assignmentId: z.uuid() }), raw);
  const assignment = await assignmentForPortal(db, assignmentId);
  const chain = await chainForActor(db, ctx, 'prayer.reports.view', assignment.chainId);
  if (!assignment.reportResponseId) throw notFound('report');
  const [response] = await db.select().from(formResponses).where(eq(formResponses.id, assignment.reportResponseId));
  const pastoral = hasGlobal(ctx, 'prayer.requests.confidential.view');
  // Opened from a named slot, an anonymous report would reveal its author.
  if (!response || (response.isAnonymous && !pastoral)) throw notFound('report');

  const [version, sets] = await Promise.all([
    getFormVersion(db, response.formVersionId),
    db.select().from(formAnswerSets).where(eq(formAnswerSets.responseId, response.id)),
  ]);
  const readable = sets.filter((set) => pastoral || set.sensitivity !== 'confidential');
  const answers: Record<string, AnswerValue> = Object.assign({}, ...readable.map((set) => set.answers as Record<string, AnswerValue>));
  const privateAnswers = sets
    .filter((set) => !readable.includes(set))
    .reduce((count, set) => count + Object.keys(set.answers as Record<string, unknown>).length, 0);

  await recordAudit(db, ctx, {
    category: 'access',
    action: 'prayer.report_viewed',
    entityType: 'prayer_assignment',
    entityId: assignment.id,
    newValues: { includedConfidential: pastoral && sets.some((set) => set.sensitivity === 'confidential') },
  });

  return {
    chainName: chain.name,
    personName: displayName(assignment),
    anonymous: response.isAnonymous,
    slotLabel: formatSlotRange(assignment.startsAt, assignment.endsAt, chain.timezone, { withDate: true }),
    submittedAt: response.submittedAt,
    answers: (version?.fields ?? []).filter((field) => answers[field.key] !== undefined).map((field) => ({ label: field.label, value: answers[field.key]! })),
    privateAnswers,
  };
}
