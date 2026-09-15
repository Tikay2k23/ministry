import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import { validationError } from '../../errors';
import { assertCanAccessPerson, assertPermission, canAccessPerson, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { addDays, localDate } from '../journal/journal-dates';
import { ensureJournalLedger } from '../journal/ledger.service';
import { displayName } from '../people/people.queries';
import { getSetting } from '../settings/settings.service';
import { csvFilename, toCsv } from './csv';

/**
 * Journal reports over a period (docs/01 FR-RPT-01..03). Built on the status ledger only —
 * reports never include journal answers — and scoped by journal.status.view like the Today page.
 * Counts are shown as "received of due" (due = received + no journal); excused days and days
 * still open don't count against anyone.
 */

const MAX_SPAN_DAYS = 62;
const MAX_ROWS = 5000;

export type ReportDayStatus = 'pending' | 'submitted' | 'late' | 'missed' | 'excused';
export type ReportView = 'direct' | 'branch' | 'all';

export const REPORT_STATUS_LABEL: Record<ReportDayStatus, string> = {
  submitted: 'Received',
  late: 'Received late',
  pending: 'Not yet',
  missed: 'No journal',
  excused: 'Excused',
};

export const JournalReportInput = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  leaderId: z.uuid().optional().catch(undefined),
  view: z.enum(['direct', 'branch', 'all']).optional().catch(undefined),
});

interface Counts {
  received: number;
  late: number;
  missed: number;
  excused: number;
}

async function personName(db: Database, personId: string) {
  const [row] = await queryRows<{ first_name: string; last_name: string; preferred_name: string | null }>(
    db,
    sql`SELECT first_name, last_name, preferred_name FROM people WHERE id = ${personId}::uuid`,
  );
  return row ? displayName({ firstName: row.first_name, lastName: row.last_name, preferredName: row.preferred_name }) : '';
}

async function leadsAnyone(db: Database, personId: string) {
  const [row] = await queryRows<{ leads: boolean }>(
    db,
    sql`SELECT EXISTS (SELECT 1 FROM hierarchy_nodes WHERE parent_person_id = ${personId}::uuid) AS leads`,
  );
  return row?.leads === true;
}

/** Period, leader and view shared by both reports. */
async function preparePeriod(db: Database, ctx: RequestContext, raw: unknown, options: { groups: boolean }) {
  assertPermission(ctx, 'reports.view');
  assertPermission(ctx, 'journal.status.view');
  const input = parseInput(JournalReportInput, raw ?? {});
  await ensureJournalLedger(db, ctx.now);
  const { timezone } = await getSetting(db, 'ministry.profile');
  const today = localDate(ctx.now, timezone);

  const to = input.to && input.to <= today ? input.to : today;
  const from = input.from && input.from <= to ? input.from : addDays(to, -6);
  if (from < addDays(to, -(MAX_SPAN_DAYS - 1))) {
    throw validationError({ from: [`Choose a period of at most ${MAX_SPAN_DAYS} days.`] });
  }
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const selfId = ctx.actor.kind === 'user' ? ctx.actor.personId : null;
  let leaderId: string | null = null;
  if (options.groups || input.view !== 'all') {
    if (input.leaderId) {
      await assertCanAccessPerson(db, ctx, 'journal.status.view', input.leaderId);
      leaderId = input.leaderId;
    } else if (selfId && (await leadsAnyone(db, selfId)) && (await canAccessPerson(db, ctx, 'journal.status.view', selfId))) {
      leaderId = selfId;
    } else if (options.groups) {
      // Office staff: start from the top of the structure when there is a single root.
      const roots = await queryRows<{ person_id: string }>(db, sql`SELECT person_id FROM hierarchy_nodes WHERE parent_person_id IS NULL LIMIT 2`);
      if (roots.length === 1 && (await canAccessPerson(db, ctx, 'journal.status.view', roots[0]!.person_id))) leaderId = roots[0]!.person_id;
    }
  }
  const view: ReportView = !leaderId ? 'all' : input.view === 'branch' ? 'branch' : 'direct';

  return {
    from,
    to,
    today,
    dates,
    view,
    leaderId,
    leader: leaderId ? { id: leaderId, name: await personName(db, leaderId), isSelf: leaderId === selfId } : null,
  };
}

const scopedDays = (ctx: RequestContext, from: string, to: string) =>
  sql`d.journal_date BETWEEN ${from}::date AND ${to}::date
      AND (d.is_expected OR d.entry_id IS NOT NULL)
      AND ${personScopeFilter(ctx, 'journal.status.view', sql`d.person_id`)}`;

// ─── By person ────────────────────────────────────────────────────────────────

export async function getJournalPeopleReport(db: Database, ctx: RequestContext, raw: unknown) {
  const period = await preparePeriod(db, ctx, raw, { groups: false });
  const group: SQL =
    period.view === 'direct'
      ? sql`d.leader_person_id = ${period.leaderId}::uuid`
      : period.view === 'branch'
        ? sql`d.hierarchy_path @> ARRAY[${period.leaderId}::uuid]`
        : sql`TRUE`;

  const rows = await queryRows<
    {
      person_id: string;
      first_name: string;
      last_name: string;
      preferred_name: string | null;
      leader_first: string | null;
      leader_last: string | null;
      days: Record<string, ReportDayStatus>;
      open: number;
    } & Counts
  >(
    db,
    sql`SELECT d.person_id, p.first_name, p.last_name, p.preferred_name,
               l.first_name AS leader_first, l.last_name AS leader_last,
               jsonb_object_agg(d.journal_date::text, d.submission_status) AS days,
               count(*) FILTER (WHERE d.submission_status IN ('submitted', 'late'))::int AS received,
               count(*) FILTER (WHERE d.submission_status = 'late')::int AS late,
               count(*) FILTER (WHERE d.submission_status = 'missed')::int AS missed,
               count(*) FILTER (WHERE d.submission_status = 'excused')::int AS excused,
               count(*) FILTER (WHERE d.submission_status = 'pending')::int AS open
          FROM journal_days d
          JOIN people p ON p.id = d.person_id
          LEFT JOIN hierarchy_nodes n ON n.person_id = d.person_id
          LEFT JOIN people l ON l.id = n.parent_person_id
         WHERE ${scopedDays(ctx, period.from, period.to)} AND ${group}
         GROUP BY d.person_id, p.first_name, p.last_name, p.preferred_name, l.first_name, l.last_name
         ORDER BY p.last_name, p.first_name, d.person_id
         LIMIT ${MAX_ROWS + 1}`,
  );

  const people = rows.slice(0, MAX_ROWS).map((r) => ({
    personId: r.person_id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    leaderName: r.leader_first ? `${r.leader_first} ${r.leader_last}` : null,
    days: r.days,
    received: Number(r.received),
    late: Number(r.late),
    missed: Number(r.missed),
    excused: Number(r.excused),
    open: Number(r.open),
  }));
  const totals = people.reduce<Counts>(
    (sum, r) => ({ received: sum.received + r.received, late: sum.late + r.late, missed: sum.missed + r.missed, excused: sum.excused + r.excused }),
    { received: 0, late: 0, missed: 0, excused: 0 },
  );
  return { ...period, rows: people, totals, truncated: rows.length > MAX_ROWS };
}

// ─── By group ─────────────────────────────────────────────────────────────────

export async function getJournalGroupsReport(db: Database, ctx: RequestContext, raw: unknown) {
  const period = await preparePeriod(db, ctx, raw, { groups: true });
  if (!period.leaderId) return { ...period, rows: [], direct: null, branch: null };

  const groups = await queryRows<{ leader_id: string; first_name: string; last_name: string; preferred_name: string | null; people: number } & Counts>(
    db,
    sql`SELECT n.person_id AS leader_id, p.first_name, p.last_name, p.preferred_name,
               count(DISTINCT d.person_id)::int AS people,
               count(d.person_id) FILTER (WHERE d.submission_status IN ('submitted', 'late'))::int AS received,
               count(d.person_id) FILTER (WHERE d.submission_status = 'late')::int AS late,
               count(d.person_id) FILTER (WHERE d.submission_status = 'missed')::int AS missed,
               count(d.person_id) FILTER (WHERE d.submission_status = 'excused')::int AS excused
          FROM hierarchy_nodes n
          JOIN people p ON p.id = n.person_id
          LEFT JOIN journal_days d
            ON d.hierarchy_path @> ARRAY[n.person_id]
           AND ${scopedDays(ctx, period.from, period.to)}
         WHERE n.parent_person_id = ${period.leaderId}::uuid
           AND EXISTS (SELECT 1 FROM hierarchy_nodes c WHERE c.parent_person_id = n.person_id)
         GROUP BY n.person_id, p.first_name, p.last_name, p.preferred_name
         ORDER BY p.last_name, p.first_name`,
  );

  const [overall] = await queryRows<Record<string, number>>(
    db,
    sql`SELECT count(DISTINCT d.person_id) FILTER (WHERE d.leader_person_id = ${period.leaderId}::uuid)::int AS direct_people,
               count(*) FILTER (WHERE d.leader_person_id = ${period.leaderId}::uuid AND d.submission_status IN ('submitted', 'late'))::int AS direct_received,
               count(*) FILTER (WHERE d.leader_person_id = ${period.leaderId}::uuid AND d.submission_status = 'late')::int AS direct_late,
               count(*) FILTER (WHERE d.leader_person_id = ${period.leaderId}::uuid AND d.submission_status = 'missed')::int AS direct_missed,
               count(*) FILTER (WHERE d.leader_person_id = ${period.leaderId}::uuid AND d.submission_status = 'excused')::int AS direct_excused,
               count(DISTINCT d.person_id)::int AS branch_people,
               count(*) FILTER (WHERE d.submission_status IN ('submitted', 'late'))::int AS branch_received,
               count(*) FILTER (WHERE d.submission_status = 'late')::int AS branch_late,
               count(*) FILTER (WHERE d.submission_status = 'missed')::int AS branch_missed,
               count(*) FILTER (WHERE d.submission_status = 'excused')::int AS branch_excused
          FROM journal_days d
         WHERE d.hierarchy_path @> ARRAY[${period.leaderId}::uuid] AND ${scopedDays(ctx, period.from, period.to)}`,
  );
  const pick = (prefix: 'direct' | 'branch') => ({
    people: Number(overall?.[`${prefix}_people`] ?? 0),
    received: Number(overall?.[`${prefix}_received`] ?? 0),
    late: Number(overall?.[`${prefix}_late`] ?? 0),
    missed: Number(overall?.[`${prefix}_missed`] ?? 0),
    excused: Number(overall?.[`${prefix}_excused`] ?? 0),
  });

  return {
    ...period,
    rows: groups.map((g) => ({
      leaderId: g.leader_id,
      name: displayName({ firstName: g.first_name, lastName: g.last_name, preferredName: g.preferred_name }),
      people: Number(g.people),
      received: Number(g.received),
      late: Number(g.late),
      missed: Number(g.missed),
      excused: Number(g.excused),
    })),
    direct: pick('direct'),
    branch: pick('branch'),
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export async function exportJournalReport(db: Database, ctx: RequestContext, raw: unknown, kind: 'people' | 'groups') {
  assertPermission(ctx, 'reports.export');

  if (kind === 'people') {
    const report = await getJournalPeopleReport(db, ctx, raw);
    const csv = toCsv(
      ['Name', 'Leader', ...report.dates, 'Received', 'Late', 'No journal', 'Excused'],
      report.rows.map((r) => [
        r.name,
        r.leaderName ?? '',
        ...report.dates.map((d) => (r.days[d] ? REPORT_STATUS_LABEL[r.days[d]] : '')),
        r.received,
        r.late,
        r.missed,
        r.excused,
      ]),
    );
    await recordAudit(db, ctx, {
      category: 'access',
      action: 'report.exported',
      entityType: 'report',
      entityId: 'journal_people',
      newValues: { from: report.from, to: report.to, view: report.view, leaderId: report.leaderId, rows: report.rows.length },
    });
    return { filename: csvFilename('journal', report.from, 'to', report.to), csv };
  }

  const report = await getJournalGroupsReport(db, ctx, raw);
  const line = (label: string, c: { people: number } & Counts) => [label, c.people, c.received, c.late, c.missed, c.excused];
  const rows: unknown[][] = [];
  if (report.leader && report.direct && report.branch) {
    rows.push(line(`${report.leader.name} — direct group`, report.direct));
    for (const g of report.rows) rows.push(line(`${g.name} — branch`, g));
    rows.push(line(`${report.leader.name} — whole branch`, report.branch));
  }
  const csv = toCsv(['Group', 'People', 'Received', 'Late', 'No journal', 'Excused'], rows);
  await recordAudit(db, ctx, {
    category: 'access',
    action: 'report.exported',
    entityType: 'report',
    entityId: 'journal_groups',
    newValues: { from: report.from, to: report.to, leaderId: report.leaderId, rows: rows.length },
  });
  return { filename: csvFilename('journal-groups', report.from, 'to', report.to), csv };
}
