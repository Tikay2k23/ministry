import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { looksLikePhone, normalizePhone } from '@/lib/phone';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import type { Sensitivity } from '../../db/enums';
import {
  careFollowups,
  formAnswerSets,
  formResponses,
  journalAttachments,
  journalDays,
  journalEntries,
  journalReviews,
  people,
  users,
} from '../../db/schema';
import { forbidden, notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, canAccessPerson, hasPermission, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { answerToText, type AnswerValue } from '../forms/answers';
import { getFormVersion } from '../forms/forms.service';
import { displayName } from '../people/people.queries';
import { getSetting } from '../settings/settings.service';
import { resolveContentAccess, visibleTiers } from './content-access';
import { addDays, localDate } from './journal-dates';
import { ensureJournalLedger } from './ledger.service';

/**
 * Portal journal views (docs/04 §5, docs/05 W5). Status comes from the narrow ledger and is
 * scoped by journal.status.view; answers are loaded only per permitted sensitivity tier.
 */

const PAGE_SIZE = 50;
const REVIEW_WINDOW_DAYS = 14;

type DayStatus = (typeof journalDays.$inferSelect)['submissionStatus'];

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

async function ministryToday(db: Database, now: Date) {
  const { timezone, defaultCountry } = await getSetting(db, 'ministry.profile');
  return { timezone, defaultCountry, today: localDate(now, timezone) };
}

async function leadsAnyone(db: Database, personId: string) {
  const [row] = await queryRows<{ leads: boolean }>(
    db,
    sql`SELECT EXISTS (SELECT 1 FROM hierarchy_nodes WHERE parent_person_id = ${personId}::uuid) AS leads`,
  );
  return row?.leads === true;
}

// ─── Today / any day overview ─────────────────────────────────────────────────

export const JOURNAL_STATUS_FILTERS = ['all', 'received', 'late', 'not_yet', 'missed', 'excused', 'awaiting_review', 'has_proof'] as const;
export type JournalStatusFilter = (typeof JOURNAL_STATUS_FILTERS)[number];
export type JournalView = 'direct' | 'branch' | 'all';
/** How a person is counted in the ministry: two of these come from the tree, two from their record. */
export const JOURNAL_ROLE_FILTERS = ['all', 'primary_leader', 'leader', 'worker', 'member'] as const;
export type JournalRoleFilter = (typeof JOURNAL_ROLE_FILTERS)[number];
export const JOURNAL_SORTS = ['status', 'name', 'leader', 'received'] as const;
export type JournalSort = (typeof JOURNAL_SORTS)[number];
export const JOURNAL_PAGE_SIZES = [25, 50, 100] as const;

export const JournalOverviewInput = z.object({
  date: z.iso.date().optional().catch(undefined),
  /** A whole branch, by the Primary Leader the ledger recorded for that day. */
  primaryLeaderId: z.uuid().optional().catch(undefined),
  leaderId: z.uuid().optional().catch(undefined),
  view: z.enum(['direct', 'branch', 'all']).optional().catch(undefined),
  ministryId: z.uuid().optional().catch(undefined),
  role: z.enum(JOURNAL_ROLE_FILTERS).catch('all'),
  /** Name search. Mobile numbers are matched too, but only for people allowed to see them. */
  q: z.string().trim().min(1).max(80).optional().catch(undefined),
  status: z.enum(JOURNAL_STATUS_FILTERS).catch('all'),
  sort: z.enum(JOURNAL_SORTS).catch('status'),
  pageSize: z.coerce.number().int().catch(25),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/**
 * Sorting the page. The default puts the people who need attention first — nobody opens this page
 * hoping to read an alphabetical list of who already sent theirs.
 */
function orderFor(sort: JournalSort, leader: ReturnType<typeof alias<typeof people, 'leader'>>): SQL[] {
  switch (sort) {
    case 'name':
      return [asc(people.lastName) as unknown as SQL, asc(people.firstName) as unknown as SQL];
    case 'leader':
      return [sql`${leader.lastName} NULLS LAST`, sql`${leader.firstName}`, asc(people.lastName) as unknown as SQL];
    case 'received':
      return [sql`${journalEntries.firstSubmittedAt} DESC NULLS LAST`, asc(people.lastName) as unknown as SQL];
    case 'status':
      return [
        sql`CASE ${journalDays.submissionStatus} WHEN 'pending' THEN 0 WHEN 'missed' THEN 1 WHEN 'late' THEN 2 WHEN 'submitted' THEN 3 ELSE 4 END`,
        asc(people.lastName) as unknown as SQL,
        asc(people.firstName) as unknown as SQL,
      ];
  }
}

/** A journal that carries a photo of the written page (docs/02 §4). */
const hasProofCondition = sql`EXISTS (
  SELECT 1 FROM journal_attachments ja
  WHERE ja.entry_id = ${journalDays.entryId} AND ja.kind = 'proof' AND ja.status = 'attached')`;

function statusCondition(status: JournalStatusFilter): SQL | undefined {
  switch (status) {
    case 'received':
      return sql`${journalDays.submissionStatus} IN ('submitted', 'late')`;
    case 'late':
      return eq(journalDays.submissionStatus, 'late');
    case 'not_yet':
      return eq(journalDays.submissionStatus, 'pending');
    case 'missed':
      return eq(journalDays.submissionStatus, 'missed');
    case 'excused':
      return eq(journalDays.submissionStatus, 'excused');
    case 'awaiting_review':
      return eq(journalDays.reviewStatus, 'awaiting');
    case 'has_proof':
      return hasProofCondition;
    case 'all':
      return undefined;
  }
}

/**
 * Ministry membership and the leadership tree are different things: someone can be in Angelo's
 * branch and serve in Worship. This filters on the membership, leaving the branch filter alone.
 */
const ministryCondition = (ministryId: string): SQL => sql`EXISTS (
  SELECT 1 FROM ministry_memberships mm
  WHERE mm.person_id = ${journalDays.personId} AND mm.ministry_id = ${ministryId}::uuid AND mm.ended_on IS NULL)`;

/**
 * Name search, the same expression and the same phone rule as the people directory
 * (people.queries.ts), so the two pages find the same person for the same words. A mobile number
 * matches only for someone allowed to see that person's contact details; for anyone else it finds
 * nobody, rather than confirming the number belongs to someone here.
 */
function searchCondition(ctx: RequestContext, q: string, defaultCountry: string): SQL {
  const personId = journalDays.personId;
  if (looksLikePhone(q)) {
    const phone = normalizePhone(q, defaultCountry);
    if (!phone.ok) return sql`FALSE`;
    return sql`EXISTS (SELECT 1 FROM people p WHERE p.id = ${personId} AND p.phone_e164 = ${phone.e164}
      AND ${personScopeFilter(ctx, 'people.contact.view', personId)})`;
  }
  const escaped = q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`EXISTS (
    SELECT 1 FROM people p
    WHERE p.id = ${personId}
      AND (p.search_name % lower(immutable_unaccent(${q})) OR p.search_name LIKE lower(immutable_unaccent(${`%${escaped}%`}))))`;
}

/**
 * How a person is counted in the ministry: Primary Leaders and leaders are read from the tree (who
 * leads whom), workers and members from the person's own designations, so nothing is maintained
 * twice. The column and the filter share this one expression, so the list can never show a role
 * that the filter above it then disagrees with.
 */
function roleExpression(primaryLeaderDepth: number): SQL<JournalRoleFilter> {
  return sql`CASE
      WHEN EXISTS (SELECT 1 FROM hierarchy_nodes n WHERE n.person_id = ${journalDays.personId} AND n.depth = ${primaryLeaderDepth}) THEN 'primary_leader'
      WHEN EXISTS (SELECT 1 FROM hierarchy_nodes n
                    WHERE n.person_id = ${journalDays.personId}
                      AND EXISTS (SELECT 1 FROM hierarchy_nodes c WHERE c.parent_person_id = n.person_id)) THEN 'leader'
      WHEN EXISTS (SELECT 1 FROM person_designations pd
                    WHERE pd.person_id = ${journalDays.personId} AND pd.designation_key = 'worker' AND pd.ended_on IS NULL) THEN 'worker'
      ELSE 'member'
    END`;
}

export async function getJournalOverview(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'journal.status.view');
  const input = parseInput(JournalOverviewInput, raw ?? {});
  await ensureJournalLedger(db, ctx.now);
  const { today, defaultCountry } = await ministryToday(db, ctx.now);
  const date = input.date && input.date <= today ? input.date : today;
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;

  let leaderId: string | null = null;
  if (input.view !== 'all') {
    if (input.leaderId) {
      await assertCanAccessPerson(db, ctx, 'journal.status.view', input.leaderId);
      leaderId = input.leaderId;
      // Opening a Primary Leader's card means "show me this branch", so a leader who lands on
      // their own group by default steps up to the branch rather than staying inside it.
    } else if (!input.primaryLeaderId && selfId && (await leadsAnyone(db, selfId)) && (await canAccessPerson(db, ctx, 'journal.status.view', selfId))) {
      leaderId = selfId;
    }
  }
  const view: JournalView = !leaderId ? 'all' : input.view === 'branch' ? 'branch' : 'direct';

  // One card per Primary Leader, for the overview at the top of the page. The ledger's own branch
  // snapshot means this is a single grouped read, whatever the size of the ministry, and it stays
  // correct for past days after someone moves between branches.
  const branchRows = await queryRows<{
    id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    expected: number;
    received: number;
    not_yet: number;
    missed: number;
    excused: number;
  }>(
    db,
    sql`SELECT d.primary_leader_person_id AS id, p.first_name, p.last_name, p.preferred_name,
               count(*) FILTER (WHERE d.is_expected)::int AS expected,
               count(*) FILTER (WHERE d.submission_status IN ('submitted', 'late'))::int AS received,
               count(*) FILTER (WHERE d.submission_status = 'pending')::int AS not_yet,
               count(*) FILTER (WHERE d.submission_status = 'missed')::int AS missed,
               count(*) FILTER (WHERE d.submission_status = 'excused')::int AS excused
          FROM journal_days d
          JOIN people p ON p.id = d.primary_leader_person_id
         WHERE d.journal_date = ${date}::date
           AND d.primary_leader_person_id IS NOT NULL
           AND (d.is_expected OR d.entry_id IS NOT NULL)
           AND ${personScopeFilter(ctx, 'journal.status.view', sql`d.person_id`)}
         GROUP BY d.primary_leader_person_id, p.first_name, p.last_name, p.preferred_name
         ORDER BY p.last_name, p.first_name`,
  );

  // A branch chosen from the Primary Leader cards. The ledger already records which branch each
  // person was in on the day (docs/03 §4.7), so this is one indexed column rather than a walk of
  // the tree — and it stays right for past days after someone moves.
  //
  // A leader sees their own branch from below: they may narrow to it without being allowed to open
  // the Primary Leader's own record, so a branch they can already see people in is enough.
  let primaryLeaderId: string | null = null;
  let primaryLeaderName: string | null = null;
  if (input.primaryLeaderId) {
    const card = branchRows.find((b) => b.id === input.primaryLeaderId);
    if (!card && !(await canAccessPerson(db, ctx, 'journal.status.view', input.primaryLeaderId))) {
      throw notFound('That group is not available.');
    }
    primaryLeaderId = input.primaryLeaderId;
    primaryLeaderName = card ? displayName({ firstName: card.first_name, lastName: card.last_name, preferredName: card.preferred_name }) : null;
  }

  const { primaryLeaderDepth } = await getSetting(db, 'hierarchy');
  const contactVisible = hasPermission(ctx, 'people.contact.view');

  const conditions: SQL[] = [
    eq(journalDays.journalDate, date),
    sql`(${journalDays.isExpected} OR ${journalDays.entryId} IS NOT NULL)`,
    personScopeFilter(ctx, 'journal.status.view', journalDays.personId),
  ];
  if (primaryLeaderId) conditions.push(eq(journalDays.primaryLeaderPersonId, primaryLeaderId));
  if (view === 'direct') conditions.push(eq(journalDays.leaderPersonId, leaderId!));
  if (view === 'branch') conditions.push(sql`${journalDays.hierarchyPath} @> ARRAY[${leaderId}]::uuid[]`);
  if (input.ministryId) conditions.push(ministryCondition(input.ministryId));
  const roleExpr = roleExpression(primaryLeaderDepth);
  if (input.role !== 'all') conditions.push(sql`${roleExpr} = ${input.role}`);
  if (input.q) conditions.push(searchCondition(ctx, input.q, defaultCountry));
  const where = and(...conditions)!;

  const countWhere = (condition: SQL) => sql<number>`count(*) FILTER (WHERE ${condition})`.mapWith(Number);
  const [summary] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      expected: countWhere(sql`${journalDays.isExpected}`),
      received: countWhere(sql`${journalDays.submissionStatus} IN ('submitted', 'late')`),
      late: countWhere(sql`${journalDays.submissionStatus} = 'late'`),
      notYet: countWhere(sql`${journalDays.submissionStatus} = 'pending'`),
      missed: countWhere(sql`${journalDays.submissionStatus} = 'missed'`),
      excused: countWhere(sql`${journalDays.submissionStatus} = 'excused'`),
      awaitingReview: countWhere(sql`${journalDays.reviewStatus} = 'awaiting'`),
      needsCare: countWhere(sql`${journalDays.careStatus} = 'needs_follow_up'`),
      withProof: countWhere(hasProofCondition),
    })
    .from(journalDays)
    .where(where);

  const leader = alias(people, 'leader');
  const filter = statusCondition(input.status);
  const pageSize = (JOURNAL_PAGE_SIZES as readonly number[]).includes(input.pageSize) ? input.pageSize : 25;
  const rows = await db
    .select({
      personId: journalDays.personId,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      status: journalDays.submissionStatus,
      reviewStatus: journalDays.reviewStatus,
      careStatus: journalDays.careStatus,
      excuseReason: journalDays.excuseReason,
      isExpected: journalDays.isExpected,
      receivedAt: journalEntries.firstSubmittedAt,
      channel: journalEntries.channel,
      // Only whether a photo is there: the list never loads or signs images (docs/02 §4).
      proofAttached: sql<boolean>`EXISTS (
        SELECT 1 FROM journal_attachments ja
        WHERE ja.entry_id = ${journalDays.entryId} AND ja.kind = 'proof' AND ja.status = 'attached')`.mapWith(Boolean),
      role: roleExpr,
      ministryName: sql<string | null>`(
        SELECT m.name FROM ministry_memberships mm
          JOIN ministries m ON m.id = mm.ministry_id
         WHERE mm.person_id = ${journalDays.personId} AND mm.ended_on IS NULL
         ORDER BY mm.is_primary DESC, m.name
         LIMIT 1)`,
      leaderFirstName: leader.firstName,
      leaderLastName: leader.lastName,
    })
    .from(journalDays)
    .innerJoin(people, eq(people.id, journalDays.personId))
    .leftJoin(journalEntries, eq(journalEntries.id, journalDays.entryId))
    .leftJoin(leader, eq(leader.id, journalDays.leaderPersonId))
    .where(filter ? and(where, filter) : where)
    .orderBy(...orderFor(input.sort, leader), asc(people.id))
    .limit(pageSize)
    .offset((input.page - 1) * pageSize);

  // Seven-day dots for the people on this page.
  const from = addDays(date, -6);
  const history = rows.length
    ? await db
        .select({ personId: journalDays.personId, journalDate: journalDays.journalDate, status: journalDays.submissionStatus })
        .from(journalDays)
        .where(
          and(
            inArray(
              journalDays.personId,
              rows.map((r) => r.personId),
            ),
            gte(journalDays.journalDate, from),
            lte(journalDays.journalDate, date),
          ),
        )
    : [];
  const historyByPerson = new Map<string, Map<string, DayStatus>>();
  for (const h of history) {
    if (!historyByPerson.has(h.personId)) historyByPerson.set(h.personId, new Map());
    historyByPerson.get(h.personId)!.set(h.journalDate, h.status);
  }
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  // Groups led by the leader's direct members (one level down), counted over their whole branch.
  const groups = leaderId
    ? await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null; expected: number; received: number; not_yet: number; missed: number }>(
        db,
        sql`SELECT n.person_id AS id, p.first_name, p.last_name, p.preferred_name,
                   count(d.person_id) FILTER (WHERE d.is_expected)::int AS expected,
                   count(d.person_id) FILTER (WHERE d.submission_status IN ('submitted', 'late'))::int AS received,
                   count(d.person_id) FILTER (WHERE d.submission_status = 'pending')::int AS not_yet,
                   count(d.person_id) FILTER (WHERE d.submission_status = 'missed')::int AS missed
              FROM hierarchy_nodes n
              JOIN people p ON p.id = n.person_id
              LEFT JOIN journal_days d
                ON d.journal_date = ${date}::date
               AND d.hierarchy_path @> ARRAY[n.person_id]
               AND (d.is_expected OR d.entry_id IS NOT NULL)
               AND ${personScopeFilter(ctx, 'journal.status.view', sql`d.person_id`)}
             WHERE n.parent_person_id = ${leaderId}::uuid
               AND EXISTS (SELECT 1 FROM hierarchy_nodes c WHERE c.parent_person_id = n.person_id)
             GROUP BY n.person_id, p.first_name, p.last_name, p.preferred_name
             ORDER BY p.last_name, p.first_name`,
      )
    : [];


  const [leaderPerson] = leaderId
    ? await db
        .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
        .from(people)
        .where(eq(people.id, leaderId))
    : [];

  const totals: Record<JournalStatusFilter, number> = {
    all: summary!.total,
    received: summary!.received,
    late: summary!.late,
    not_yet: summary!.notYet,
    missed: summary!.missed,
    excused: summary!.excused,
    awaiting_review: summary!.awaitingReview,
    has_proof: summary!.withProof,
  };

  // The leaders inside the chosen branch, for the Direct Leader picker. Read from the tree rather
  // than from the day, so the list is the same whichever date is being looked at.
  const branchLeaders = primaryLeaderId
    ? await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null }>(
        db,
        sql`SELECT n.person_id AS id, p.first_name, p.last_name, p.preferred_name
              FROM hierarchy_nodes n
              JOIN people p ON p.id = n.person_id
             WHERE n.primary_leader_person_id = ${primaryLeaderId}::uuid
               AND n.person_id <> ${primaryLeaderId}::uuid
               AND EXISTS (SELECT 1 FROM hierarchy_nodes c WHERE c.parent_person_id = n.person_id)
               AND ${personScopeFilter(ctx, 'journal.status.view', sql`n.person_id`)}
             ORDER BY p.last_name, p.first_name
             LIMIT 300`,
      )
    : [];

  if (primaryLeaderId && !primaryLeaderName) {
    const [row] = await db
      .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
      .from(people)
      .where(eq(people.id, primaryLeaderId));
    primaryLeaderName = row ? displayName(row) : null;
  }

  return {
    date,
    today,
    view,
    status: input.status,
    role: input.role,
    ministryId: input.ministryId ?? null,
    q: input.q ?? null,
    sort: input.sort,
    contactVisible,
    leader: leaderId && leaderPerson ? { id: leaderId, name: displayName(leaderPerson), isSelf: leaderId === selfId } : null,
    primaryLeader: primaryLeaderId && primaryLeaderName ? { id: primaryLeaderId, name: primaryLeaderName } : null,
    /** One per Primary Leader who has anyone on this day, for the cards at the top of the page. */
    branches: branchRows.map((b) => ({
      primaryLeaderId: b.id,
      name: displayName({ firstName: b.first_name, lastName: b.last_name, preferredName: b.preferred_name }),
      expected: b.expected,
      received: b.received,
      notYet: b.not_yet,
      missed: b.missed,
      excused: b.excused,
    })),
    branchLeaders: branchLeaders.map((l) => ({
      id: l.id,
      name: displayName({ firstName: l.first_name, lastName: l.last_name, preferredName: l.preferred_name }),
    })),
    summary: summary!,
    groups: groups.map((g) => ({
      leaderId: g.id,
      leaderName: displayName({ firstName: g.first_name, lastName: g.last_name, preferredName: g.preferred_name }),
      expected: g.expected,
      received: g.received,
      notYet: g.not_yet,
      missed: g.missed,
    })),
    people: rows.map((r) => ({
      personId: r.personId,
      name: displayName(r),
      status: r.status,
      reviewStatus: r.reviewStatus,
      careStatus: r.careStatus,
      excuseReason: r.excuseReason,
      isExpected: r.isExpected,
      receivedAt: r.receivedAt,
      byProxy: r.channel === 'proxy',
      proofAttached: r.proofAttached,
      role: r.role,
      ministryName: r.ministryName,
      // The leader the ledger recorded for that day, so a past day keeps the leader of the time.
      leaderName: r.leaderFirstName ? `${r.leaderFirstName} ${r.leaderLastName}` : null,
      week: weekDates.map((d) => ({ date: d, status: historyByPerson.get(r.personId)?.get(d) ?? null })),
    })),
    page: input.page,
    pageSize,
    totals,
    total: totals[input.status],
  };
}

// ─── One person's journal (profile section) ───────────────────────────────────

export async function getPersonJournalSummary(db: Database, ctx: RequestContext, personId: string) {
  if (!z.uuid().safeParse(personId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'journal.status.view', personId);
  await ensureJournalLedger(db, ctx.now);
  const [{ today }, policy] = await Promise.all([ministryToday(db, ctx.now), getSetting(db, 'journal.policy')]);
  const from = addDays(today, -29);

  const rows = await db
    .select({
      journalDate: journalDays.journalDate,
      status: journalDays.submissionStatus,
      isExpected: journalDays.isExpected,
      excuseReason: journalDays.excuseReason,
      hasEntry: sql<boolean>`${journalDays.entryId} IS NOT NULL`,
    })
    .from(journalDays)
    .where(and(eq(journalDays.personId, personId), gte(journalDays.journalDate, from), lte(journalDays.journalDate, today)))
    .orderBy(asc(journalDays.journalDate));
  const byDate = new Map(rows.map((r) => [r.journalDate, r]));
  const received = rows.filter((r) => r.status === 'submitted' || r.status === 'late').length;
  const counted = rows.filter((r) => r.status === 'submitted' || r.status === 'late' || (r.isExpected && r.status === 'missed')).length;

  const [person] = await db
    .select({ firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
    .from(people)
    .where(eq(people.id, personId));

  const [canExcuse, canProxy] = await Promise.all([
    canAccessPerson(db, ctx, 'journal.excuse', personId),
    canAccessPerson(db, ctx, 'journal.proxy_submit', personId),
  ]);

  return {
    person: { id: personId, name: person ? displayName(person) : '', firstName: person?.firstName ?? '' },
    today,
    days: Array.from({ length: 30 }, (_, i) => {
      const d = addDays(from, i);
      const r = byDate.get(d);
      return { date: d, status: r?.status ?? null, excuseReason: r?.excuseReason ?? null, hasEntry: r?.hasEntry ?? false };
    }),
    consistency: policy.showStreaksToLeaders ? { received, of: counted } : null,
    canExcuse,
    canProxy: canProxy && !(ctx.actor.kind === 'user' && ctx.actor.personId === personId),
  };
}

// ─── One journal entry ────────────────────────────────────────────────────────

export const JournalEntryInput = z.object({ personId: z.uuid(), date: z.iso.date() });

export async function getJournalEntry(db: Database, ctx: RequestContext, raw: unknown) {
  const { personId, date } = parseInput(JournalEntryInput, raw);
  await assertCanAccessPerson(db, ctx, 'journal.status.view', personId);

  const [row] = await db
    .select({
      day: journalDays,
      entry: journalEntries,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
    })
    .from(journalDays)
    .innerJoin(people, eq(people.id, journalDays.personId))
    .leftJoin(journalEntries, eq(journalEntries.id, journalDays.entryId))
    .where(and(eq(journalDays.personId, personId), eq(journalDays.journalDate, date)));
  if (!row) throw notFound('journal day');

  const { day, entry } = row;
  const isOwn = ctx.actor.kind === 'user' && ctx.actor.personId === personId;
  const [canReview, canExcuse] = await Promise.all([
    canAccessPerson(db, ctx, 'journal.review', personId),
    canAccessPerson(db, ctx, 'journal.excuse', personId),
  ]);
  const base = {
    person: { id: personId, name: displayName(row) },
    date,
    status: day.submissionStatus,
    reviewStatus: day.reviewStatus,
    careStatus: day.careStatus,
    excuseReason: day.excuseReason,
    isExpected: day.isExpected,
    finalized: day.finalizedAt !== null,
    canExcuse,
  };
  if (!entry) return { ...base, canReview: false, entry: null };

  const policy = await getSetting(db, 'journal.policy');
  const access = await resolveContentAccess(db, ctx, { personId, hierarchyPath: day.hierarchyPath }, policy.contentVisibilityDepth);
  const tiers = visibleTiers(access);

  let answers: { key: string; label: string; type: string; sensitivity: Sensitivity; text: string }[] = [];
  let hiddenCount = 0;
  if (!entry.contentPurgedAt) {
    // Hidden tiers are counted in SQL; their content never leaves the database.
    const tierCounts = await queryRows<{ sensitivity: Sensitivity; answer_count: number }>(
      db,
      sql`SELECT sensitivity, (SELECT count(*) FROM jsonb_object_keys(answers))::int AS answer_count
            FROM form_answer_sets WHERE response_id = ${entry.formResponseId}::uuid`,
    );
    hiddenCount = tierCounts.filter((t) => !tiers.includes(t.sensitivity)).reduce((n, t) => n + Number(t.answer_count), 0);

    const sets = tiers.length
      ? await db
          .select({ answers: formAnswerSets.answers })
          .from(formAnswerSets)
          .where(and(eq(formAnswerSets.responseId, entry.formResponseId), inArray(formAnswerSets.sensitivity, tiers)))
      : [];
    if (sets.length > 0) {
      const [response] = await db
        .select({ formVersionId: formResponses.formVersionId })
        .from(formResponses)
        .where(eq(formResponses.id, entry.formResponseId));
      const version = response ? await getFormVersion(db, response.formVersionId) : null;
      const merged = Object.assign({}, ...sets.map((s) => s.answers as Record<string, AnswerValue>)) as Record<string, AnswerValue>;
      answers = (version?.fields ?? []).flatMap((field) => {
        const answer = merged[field.key];
        return answer && tiers.includes(field.sensitivity)
          ? [{ key: field.key, label: field.label, type: field.type, sensitivity: field.sensitivity, text: answerToText(field, answer) }]
          : [];
      });
      if (!isOwn) {
        await recordAudit(db, ctx, {
          category: 'access',
          action: 'journal.content_viewed',
          entityType: 'journal_entry',
          entityId: entry.id,
          newValues: { personId, journalDate: date, tiers },
        });
      }
    }
  }

  const userId = actorUserId(ctx);
  const reviews = await db
    .select({
      reviewerUserId: journalReviews.reviewerUserId,
      reviewerName: users.name,
      reviewedAt: journalReviews.reviewedAt,
      comment: journalReviews.comment,
      shareWithPerson: journalReviews.shareWithPerson,
      flaggedFollowUp: journalReviews.flaggedFollowUp,
    })
    .from(journalReviews)
    .innerJoin(users, eq(users.id, journalReviews.reviewerUserId))
    .where(eq(journalReviews.entryId, entry.id))
    .orderBy(asc(journalReviews.reviewedAt));

  // The photo of the written journal. Whether this viewer may open it is a separate permission
  // from reading the answers, so the id is only handed over to someone who holds it: nobody else
  // learns it exists beyond the fact that one was sent.
  const [proofRow] = await db
    .select({ id: journalAttachments.id, width: journalAttachments.width, height: journalAttachments.height })
    .from(journalAttachments)
    .where(and(eq(journalAttachments.entryId, entry.id), eq(journalAttachments.kind, 'proof'), eq(journalAttachments.status, 'attached')));
  const canSeeProof = proofRow ? await canAccessPerson(db, ctx, 'journal.proof.view', personId) : false;

  return {
    ...base,
    canReview: canReview && !isOwn,
    entry: {
      id: entry.id,
      proof: proofRow ? { attached: true, attachmentId: canSeeProof ? proofRow.id : null } : { attached: false, attachmentId: null },
      receivedAt: entry.firstSubmittedAt,
      lastEditedAt: entry.revisionNo > 1 ? entry.lastSubmittedAt : null,
      revisionNo: entry.revisionNo,
      timing: entry.timing,
      byProxy: entry.channel === 'proxy',
      purged: entry.contentPurgedAt !== null,
      contentAllowed: tiers.length > 0,
      answers,
      hiddenCount,
      reviews: reviews.map((r) => ({
        reviewerName: r.reviewerName,
        reviewedAt: r.reviewedAt,
        // Leader notes share the visibility of standard answers.
        comment: access.standard || r.reviewerUserId === userId ? r.comment : null,
        shareWithPerson: r.shareWithPerson,
        flaggedFollowUp: r.flaggedFollowUp,
        mine: r.reviewerUserId === userId,
      })),
    },
  };
}

// ─── Review ───────────────────────────────────────────────────────────────────

export async function listAwaitingReview(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'journal.review');
  const { page } = parseInput(z.object({ page: z.coerce.number().int().min(1).max(10_000).catch(1) }), raw ?? {});
  await ensureJournalLedger(db, ctx.now);
  const { today } = await ministryToday(db, ctx.now);
  const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;

  const where = and(
    eq(journalDays.reviewStatus, 'awaiting'),
    gte(journalDays.journalDate, addDays(today, -(REVIEW_WINDOW_DAYS - 1))),
    personScopeFilter(ctx, 'journal.review', journalDays.personId),
    selfId ? ne(journalDays.personId, selfId) : undefined,
  );
  const rows = await db
    .select({
      personId: journalDays.personId,
      journalDate: journalDays.journalDate,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      receivedAt: journalEntries.firstSubmittedAt,
      timing: journalEntries.timing,
    })
    .from(journalDays)
    .innerJoin(people, eq(people.id, journalDays.personId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalDays.entryId))
    .where(where)
    .orderBy(desc(journalDays.journalDate), asc(journalEntries.firstSubmittedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(journalDays)
    .where(where);

  return {
    items: rows.map((r) => ({
      personId: r.personId,
      name: displayName(r),
      journalDate: r.journalDate,
      receivedAt: r.receivedAt,
      timing: r.timing,
    })),
    total: count?.total ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export const ReviewInput = z.object({
  entryId: z.uuid(),
  comment: optionalText(2000),
  shareWithPerson: z.boolean().default(false),
  followUp: z.enum(['none', 'leadership', 'pastoral']).default('none'),
});

export async function reviewJournalEntry(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ReviewInput, raw);
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ id: journalEntries.id, personId: journalEntries.personId, journalDate: journalEntries.journalDate })
      .from(journalEntries)
      .where(eq(journalEntries.id, input.entryId));
    if (!entry) throw notFound('journal entry');
    await assertCanAccessPerson(tx, ctx, 'journal.review', entry.personId);
    const userId = actorUserId(ctx)!;
    const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
    if (selfId === entry.personId) throw forbidden('You can’t review your own journal.');

    const values = {
      reviewedAt: ctx.now,
      comment: input.comment ?? null,
      shareWithPerson: input.shareWithPerson,
      flaggedFollowUp: input.followUp !== 'none',
    };
    await tx
      .insert(journalReviews)
      .values({ entryId: entry.id, reviewerUserId: userId, ...values })
      .onConflictDoUpdate({ target: [journalReviews.entryId, journalReviews.reviewerUserId], set: values });
    await tx
      .update(journalDays)
      .set({ reviewStatus: 'reviewed', updatedAt: ctx.now })
      .where(eq(journalDays.entryId, entry.id));

    let followUpId: string | null = null;
    if (input.followUp !== 'none') {
      const [node] = await queryRows<{ parent_person_id: string | null }>(
        tx,
        sql`SELECT parent_person_id FROM hierarchy_nodes WHERE person_id = ${entry.personId}::uuid`,
      );
      const [created] = await tx
        .insert(careFollowups)
        .values({
          personId: entry.personId,
          kind: 'journal_flagged',
          sourceType: 'journal_entry',
          sourceRef: entry.id,
          // Pastoral follow-ups go to the pastoral pool; leadership ones to whoever flagged it.
          assignedToPersonId: input.followUp === 'pastoral' ? null : (selfId ?? node?.parent_person_id ?? null),
          visibility: input.followUp,
          summary: `Flagged while reviewing the journal for ${entry.journalDate}`,
          dedupeKey: `journal_flag:${entry.id}:${input.followUp}`,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning({ id: careFollowups.id });
      followUpId = created?.id ?? null;
      await tx
        .update(journalDays)
        .set({ careStatus: 'needs_follow_up', updatedAt: ctx.now })
        .where(eq(journalDays.entryId, entry.id));
    }

    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'journal.reviewed',
      entityType: 'journal_entry',
      entityId: entry.id,
      newValues: { followUp: input.followUp, shareWithPerson: input.shareWithPerson, hasComment: Boolean(input.comment) },
    });
    return { followUpId };
  });
}
