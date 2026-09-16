import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { formatClockTime } from '@/lib/time-range';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import { PRAYER_CHAIN_STATUSES, type PrayerChainStatus } from '../../db/enums';
import { ministries, people, prayerChainSchedules, prayerChains, prayerCommitments, prayerSlots } from '../../db/schema';
import { forbidden, invalidState, validationError } from '../../errors';
import { chainScopeFilter, canAccessChain, grantsFor, hasGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { changedFields, recordAudit } from '../audit/audit.service';
import { displayName } from '../people/people.queries';
import { ensureChainEntryCode, prayerUrlForCode } from '../public/entry-codes.service';
import { actorFromContext, chainForActor, chainToday, type ChainRow } from './common';
import { listChainCoordinators } from './coordinators.service';
import { cancelUpcomingSlots, generateChainSlots } from './generation.service';
import { CreateChainInput, describeSchedule, UpdateChainInput } from './prayer.schemas';
import { describeRecurrence, formatRecurrence, parseRecurrence } from './recurrence';
import { ensurePrayerReportForm } from './report-form';

/** Prayer chains (docs/05 W10, docs/04 A16). */

function canManageMinistryChains(ctx: RequestContext, ministryId: string | null | undefined) {
  return grantsFor(ctx, 'prayer.manage').some(
    (g) => g.scope.type === 'global' || (g.scope.type === 'ministry' && ministryId != null && g.scope.ministryId === ministryId),
  );
}

async function assertMinistryExists(db: Database, ministryId: string | null | undefined) {
  if (!ministryId) return;
  const [ministry] = await db
    .select({ id: ministries.id })
    .from(ministries)
    .where(and(eq(ministries.id, ministryId), isNull(ministries.archivedAt)));
  if (!ministry) throw validationError({ ministryId: ['That ministry does not exist.'] });
}

export async function createChain(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateChainInput, raw);
  if (!canManageMinistryChains(ctx, input.ministryId)) {
    throw forbidden('You can create prayer chains only for a ministry you manage.');
  }
  await assertMinistryExists(db, input.ministryId);

  return db.transaction(async (tx) => {
    const reportFormId = input.collectReports ? await ensurePrayerReportForm(tx) : null;
    const [chain] = await tx
      .insert(prayerChains)
      .values({
        name: input.name,
        description: input.description ?? null,
        chainType: input.chainType,
        timezone: input.timezone,
        ministryId: input.ministryId ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        graceMinutes: input.graceMinutes,
        checkinOpensMinutes: input.checkinOpensMinutes,
        requireCheckin: input.requireCheckin,
        showNamesPublicly: input.showNamesPublicly,
        reportFormId,
        createdBy: actorUserId(ctx),
      })
      .returning();
    const { schedule } = input;
    await tx.insert(prayerChainSchedules).values({
      prayerChainId: chain!.id,
      rrule: formatRecurrence(parseRecurrence(schedule.rrule)!),
      firstSlotTime: `${schedule.firstSlotTime}:00`,
      slotMinutes: schedule.slotMinutes,
      slotsPerOccurrence: schedule.slotsPerOccurrence,
      capacity: schedule.capacity,
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo ?? null,
      generateDaysAhead: schedule.generateDaysAhead,
    });
    const code = await ensureChainEntryCode(tx, chain!.id, chain!.name, actorUserId(ctx));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.chain_created',
      entityType: 'prayer_chain',
      entityId: chain!.id,
      newValues: { name: input.name, chainType: input.chainType, ministryId: input.ministryId ?? null },
    });
    return { chainId: chain!.id, code: code.code };
  });
}

export async function updateChain(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdateChainInput, raw);
  return db.transaction(async (tx) => {
    const chain = await chainForActor(tx, ctx, 'prayer.manage', input.chainId, { forUpdate: true });
    if ((input.ministryId ?? null) !== chain.ministryId && !canManageMinistryChains(ctx, input.ministryId)) {
      throw forbidden('You can move a chain only into a ministry you manage.');
    }
    await assertMinistryExists(db, input.ministryId);
    if (input.timezone !== chain.timezone) {
      const [slots] = await tx.select({ n: count() }).from(prayerSlots).where(eq(prayerSlots.prayerChainId, chain.id));
      if ((slots?.n ?? 0) > 0) throw validationError({ timezone: ['The time zone can’t change once slots have been created.'] });
    }
    const next = {
      name: input.name,
      description: input.description ?? null,
      chainType: input.chainType,
      timezone: input.timezone,
      ministryId: input.ministryId ?? null,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      graceMinutes: input.graceMinutes,
      checkinOpensMinutes: input.checkinOpensMinutes,
      requireCheckin: input.requireCheckin,
      showNamesPublicly: input.showNamesPublicly,
      reportFormId: input.collectReports ? (chain.reportFormId ?? (await ensurePrayerReportForm(tx))) : null,
    };
    await tx
      .update(prayerChains)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(prayerChains.id, chain.id));
    const diff = changedFields(chain as unknown as Record<string, unknown>, next);
    if (diff) {
      await recordAudit(tx, ctx, { category: 'change', action: 'prayer.chain_updated', entityType: 'prayer_chain', entityId: chain.id, ...diff });
    }
    return { chainId: chain.id };
  });
}

const TRANSITIONS: Record<PrayerChainStatus, PrayerChainStatus[]> = {
  draft: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

export async function setChainStatus(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(z.object({ chainId: z.uuid(), status: z.enum(PRAYER_CHAIN_STATUSES) }), raw);
  return db.transaction(async (tx) => {
    const chain = await chainForActor(tx, ctx, 'prayer.manage', input.chainId, { forUpdate: true });
    if (!TRANSITIONS[chain.status].includes(input.status)) {
      throw invalidState(`A ${chain.status} chain can’t become ${input.status}.`);
    }
    if (input.status === 'active') {
      const [schedules] = await tx.select({ n: count() }).from(prayerChainSchedules).where(eq(prayerChainSchedules.prayerChainId, chain.id));
      if ((schedules?.n ?? 0) === 0) throw invalidState('Add a schedule before starting the chain.');
    }
    await tx.update(prayerChains).set({ status: input.status, updatedAt: ctx.now }).where(eq(prayerChains.id, chain.id));

    const updated: ChainRow = { ...chain, status: input.status };
    const generated = input.status === 'active' ? await generateChainSlots(tx, updated, ctx.now) : null;
    const cancelled =
      input.status === 'ended'
        ? await cancelUpcomingSlots(tx, { chainId: chain.id, now: ctx.now, actor: actorFromContext(ctx), reason: 'Prayer chain ended' })
        : null;
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'prayer.chain_status_changed',
      entityType: 'prayer_chain',
      entityId: chain.id,
      oldValues: { status: chain.status },
      newValues: { status: input.status, slotsCreated: generated?.slotsCreated ?? null, cancelledSlots: cancelled?.slots ?? null },
    });
    return { status: input.status, generated, cancelled };
  });
}

// ─── Lists and detail ─────────────────────────────────────────────────────────

/** Coverage of the chain's slots on its own "today": covered, completed, and follow-ups waiting. */
export async function todayCoverage(executor: Executor, chain: ChainRow, now: Date) {
  const today = chainToday(chain, now);
  const [coverage] = await queryRows<{ total: number; covered: number; completed: number }>(
    executor,
    sql`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM prayer_assignments pa WHERE pa.slot_id = s.id
                                               AND pa.status NOT IN ('replaced', 'cancelled', 'excused')))::int AS covered,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM prayer_assignments pa WHERE pa.slot_id = s.id
                                               AND pa.status = 'completed'))::int AS completed
          FROM prayer_slots s
         WHERE s.prayer_chain_id = ${chain.id}::uuid AND s.status = 'open' AND s.chain_date = ${today}::date`,
  );
  const [followUps] = await queryRows<{ n: number }>(
    executor,
    sql`SELECT count(*)::int AS n FROM prayer_assignments pa JOIN prayer_slots s ON s.id = pa.slot_id
         WHERE s.prayer_chain_id = ${chain.id}::uuid AND pa.status = 'needs_follow_up'`,
  );
  return {
    today,
    total: Number(coverage?.total ?? 0),
    covered: Number(coverage?.covered ?? 0),
    completed: Number(coverage?.completed ?? 0),
    followUps: Number(followUps?.n ?? 0),
  };
}

const STATUS_ORDER: Record<PrayerChainStatus, number> = { active: 0, paused: 1, draft: 2, ended: 3 };

export async function listChains(db: Database, ctx: RequestContext) {
  const chains = await db
    .select({ chain: prayerChains, ministryName: ministries.name })
    .from(prayerChains)
    .leftJoin(ministries, eq(ministries.id, prayerChains.ministryId))
    .where(and(isNull(prayerChains.archivedAt), chainScopeFilter(ctx, 'prayer.view', prayerChains.id, prayerChains.ministryId)))
    .orderBy(asc(prayerChains.name));
  const items = [];
  for (const { chain, ministryName } of chains) {
    items.push({
      id: chain.id,
      name: chain.name,
      chainType: chain.chainType,
      status: chain.status,
      ministryId: chain.ministryId,
      ministryName,
      timezone: chain.timezone,
      coverage: await todayCoverage(db, chain, ctx.now),
    });
  }
  return items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export async function getChainDetail(db: Database, ctx: RequestContext, chainId: string) {
  const chain = await chainForActor(db, ctx, 'prayer.view', chainId);
  const [schedules, commitments, code, coordinators, coverage, ministry] = await Promise.all([
    db.select().from(prayerChainSchedules).where(eq(prayerChainSchedules.prayerChainId, chain.id)).orderBy(asc(prayerChainSchedules.createdAt)),
    db
      .select({ commitment: prayerCommitments, firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
      .from(prayerCommitments)
      .innerJoin(people, eq(people.id, prayerCommitments.personId))
      .where(and(eq(prayerCommitments.prayerChainId, chain.id), isNull(prayerCommitments.endedAt)))
      .orderBy(asc(prayerCommitments.localStartTime)),
    ensureChainEntryCode(db, chain.id, chain.name),
    listChainCoordinators(db, chain.id),
    todayCoverage(db, chain, ctx.now),
    chain.ministryId ? db.select({ name: ministries.name }).from(ministries).where(eq(ministries.id, chain.ministryId)) : Promise.resolve([]),
  ]);
  const today = chainToday(chain, ctx.now);
  const ref = { id: chain.id, ministryId: chain.ministryId };

  return {
    chain: { ...chain, ministryName: ministry[0]?.name ?? null, collectsReports: chain.reportFormId !== null },
    coverage,
    publicUrl: prayerUrlForCode(code.code),
    code: code.code,
    schedules: schedules.map((s) => ({
      id: s.id,
      description: describeSchedule(s),
      capacity: s.capacity,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      generateDaysAhead: s.generateDaysAhead,
      active: s.effectiveTo === null || s.effectiveTo >= today,
    })),
    commitments: commitments.map(({ commitment, ...person }) => {
      const rule = parseRecurrence(commitment.rrule);
      return {
        id: commitment.id,
        personId: commitment.personId,
        personName: displayName(person),
        pattern: `${rule ? describeRecurrence(rule) : 'Custom'} at ${formatClockTime(commitment.localStartTime)}`,
        effectiveFrom: commitment.effectiveFrom,
        effectiveTo: commitment.effectiveTo,
      };
    }),
    coordinators,
    can: {
      manage: canAccessChain(ctx, 'prayer.manage', ref),
      assign: canAccessChain(ctx, 'prayer.assign', ref),
      resolve: canAccessChain(ctx, 'prayer.resolve', ref),
      viewReports: canAccessChain(ctx, 'prayer.reports.view', ref),
      appointCoordinators: hasGlobal(ctx, 'iam.users.manage'),
    },
  };
}

/** Ministries the actor may create chains for (the wizard's ministry picker). */
export async function chainCreationOptions(db: Database, ctx: RequestContext) {
  const grants = grantsFor(ctx, 'prayer.manage');
  const global = grants.some((g) => g.scope.type === 'global');
  const ministryIds = grants.flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : []));
  if (!global && ministryIds.length === 0) return { canCreate: false, ministries: [], requiresMinistry: true };
  const rows = await db.select({ id: ministries.id, name: ministries.name }).from(ministries).where(isNull(ministries.archivedAt)).orderBy(asc(ministries.name));
  return {
    canCreate: true,
    requiresMinistry: !global,
    ministries: global ? rows : rows.filter((m) => ministryIds.includes(m.id)),
  };
}
