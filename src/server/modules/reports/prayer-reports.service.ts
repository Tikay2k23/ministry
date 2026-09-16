import { and, asc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import type { PrayerChainStatus } from '../../db/enums';
import { prayerChains } from '../../db/schema';
import { notFound, validationError } from '../../errors';
import { assertPermission, chainScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { addDays } from '../journal/journal-dates';
import { displayName } from '../people/people.queries';
import { chainForActor, chainToday } from '../prayer/common';
import { csvFilename, toCsv } from './csv';

/**
 * Prayer chain completion over a period (docs/01 FR-RPT-02): how many slots were covered and
 * prayed, by day and by person. Scoped like the chain board (prayer.view on the chain). Reports
 * count statuses only; they never include what anyone wrote in a prayer report.
 */

const MAX_SPAN_DAYS = 62;

export const PrayerReportInput = z.object({
  chainId: z.uuid().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

export interface PrayerDayCounts {
  /** Open slots in the chain. */
  slots: number;
  /** Slots with someone on them (not excused). */
  covered: number;
  /** Slots where someone finished praying. */
  prayed: number;
  /** Finished assignments (more than `prayed` when slots hold several people). */
  completed: number;
  /** Finished assignments marked after the slot's grace time. */
  late: number;
  followUp: number;
  missed: number;
  excused: number;
}

const COUNT_KEYS = ['slots', 'covered', 'prayed', 'completed', 'late', 'followUp', 'missed', 'excused'] as const satisfies readonly (keyof PrayerDayCounts)[];
const STATUS_ORDER: Record<PrayerChainStatus, number> = { active: 0, paused: 1, ended: 2, draft: 3 };

export async function getPrayerCompletionReport(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'reports.view');
  const input = parseInput(PrayerReportInput, raw ?? {});

  const chains = await db
    .select({ id: prayerChains.id, name: prayerChains.name, status: prayerChains.status })
    .from(prayerChains)
    .where(and(isNull(prayerChains.archivedAt), chainScopeFilter(ctx, 'prayer.view', prayerChains.id, prayerChains.ministryId)))
    .orderBy(asc(prayerChains.name));
  const chosenId = input.chainId ?? [...chains].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])[0]?.id;
  if (!chosenId) return { chains, chain: null };

  // Out-of-scope chains are NOT_FOUND, as on the board (docs/06 T14).
  const chain = await chainForActor(db, ctx, 'prayer.view', chosenId);
  const today = chainToday(chain, ctx.now);
  const to = input.to && input.to <= today ? input.to : today;
  const from = input.from && input.from <= to ? input.from : addDays(to, -6);
  if (from < addDays(to, -(MAX_SPAN_DAYS - 1))) {
    throw validationError({ from: [`Choose a period of at most ${MAX_SPAN_DAYS} days.`] });
  }

  const dayRows = await queryRows<{ date: string; slots: number; covered: number; prayed: number; completed: number; late: number; follow_up: number; missed: number; excused: number }>(
    db,
    sql`SELECT s.chain_date::text AS date,
               count(*)::int AS slots,
               count(*) FILTER (WHERE x.holders > 0)::int AS covered,
               count(*) FILTER (WHERE x.completed > 0)::int AS prayed,
               coalesce(sum(x.completed), 0)::int AS completed,
               coalesce(sum(x.late), 0)::int AS late,
               coalesce(sum(x.follow_up), 0)::int AS follow_up,
               coalesce(sum(x.missed), 0)::int AS missed,
               coalesce(sum(x.excused), 0)::int AS excused
          FROM prayer_slots s
          CROSS JOIN LATERAL (
            SELECT count(*) FILTER (WHERE a.status <> 'excused') AS holders,
                   count(*) FILTER (WHERE a.status = 'completed') AS completed,
                   count(*) FILTER (WHERE a.status = 'completed' AND a.completed_late) AS late,
                   count(*) FILTER (WHERE a.status = 'needs_follow_up') AS follow_up,
                   count(*) FILTER (WHERE a.status = 'missed') AS missed,
                   count(*) FILTER (WHERE a.status = 'excused') AS excused
              FROM prayer_assignments a
             WHERE a.slot_id = s.id AND a.status NOT IN ('replaced', 'cancelled')
          ) x
         WHERE s.prayer_chain_id = ${chain.id}::uuid
           AND s.status = 'open'
           AND s.chain_date BETWEEN ${from}::date AND ${to}::date
         GROUP BY s.chain_date
         ORDER BY s.chain_date`,
  );

  const personRows = await queryRows<{
    person_id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    slots: number;
    completed: number;
    late: number;
    follow_up: number;
    missed: number;
    excused: number;
    upcoming: number;
    handed_over: number;
  }>(
    db,
    sql`SELECT a.person_id, p.first_name, p.last_name, p.preferred_name,
               count(*) FILTER (WHERE a.status <> 'replaced')::int AS slots,
               count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
               count(*) FILTER (WHERE a.status = 'completed' AND a.completed_late)::int AS late,
               count(*) FILTER (WHERE a.status = 'needs_follow_up')::int AS follow_up,
               count(*) FILTER (WHERE a.status = 'missed')::int AS missed,
               count(*) FILTER (WHERE a.status = 'excused')::int AS excused,
               count(*) FILTER (WHERE a.status IN ('scheduled', 'confirmed', 'in_prayer'))::int AS upcoming,
               count(*) FILTER (WHERE a.status = 'replaced')::int AS handed_over
          FROM prayer_assignments a
          JOIN prayer_slots s ON s.id = a.slot_id
          JOIN people p ON p.id = a.person_id
         WHERE s.prayer_chain_id = ${chain.id}::uuid
           AND s.status = 'open'
           AND s.chain_date BETWEEN ${from}::date AND ${to}::date
           AND a.status <> 'cancelled'
         GROUP BY a.person_id, p.first_name, p.last_name, p.preferred_name
         ORDER BY p.last_name, p.first_name, a.person_id`,
  );

  const days = dayRows.map((r) => ({
    date: r.date,
    slots: Number(r.slots),
    covered: Number(r.covered),
    prayed: Number(r.prayed),
    completed: Number(r.completed),
    late: Number(r.late),
    followUp: Number(r.follow_up),
    missed: Number(r.missed),
    excused: Number(r.excused),
  }));
  const totals = Object.fromEntries(COUNT_KEYS.map((key) => [key, days.reduce((sum, day) => sum + day[key], 0)])) as unknown as PrayerDayCounts;

  return {
    chains,
    chain: { id: chain.id, name: chain.name, status: chain.status, timezone: chain.timezone },
    from,
    to,
    today,
    days,
    totals,
    people: personRows.map((r) => ({
      personId: r.person_id,
      name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
      slots: Number(r.slots),
      completed: Number(r.completed),
      late: Number(r.late),
      followUp: Number(r.follow_up),
      missed: Number(r.missed),
      excused: Number(r.excused),
      upcoming: Number(r.upcoming),
      handedOver: Number(r.handed_over),
    })),
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export async function exportPrayerReport(db: Database, ctx: RequestContext, raw: unknown, tab: 'days' | 'people') {
  assertPermission(ctx, 'reports.export');
  const report = await getPrayerCompletionReport(db, ctx, raw);
  if (!report.chain) throw notFound('prayer chain');

  const csv =
    tab === 'days'
      ? toCsv(
          ['Date', 'Slots', 'Covered', 'Prayed', 'Finished', 'Finished late', 'Needs follow-up', 'Missed', 'Excused'],
          report.days.map((d) => [d.date, d.slots, d.covered, d.prayed, d.completed, d.late, d.followUp, d.missed, d.excused]),
        )
      : toCsv(
          ['Name', 'Slots', 'Finished', 'Finished late', 'Needs follow-up', 'Missed', 'Excused', 'Still to come', 'Handed to a substitute'],
          report.people.map((p) => [p.name, p.slots, p.completed, p.late, p.followUp, p.missed, p.excused, p.upcoming, p.handedOver]),
        );
  await recordAudit(db, ctx, {
    category: 'access',
    action: 'report.exported',
    entityType: 'report',
    entityId: tab === 'days' ? 'prayer_days' : 'prayer_people',
    newValues: { chainId: report.chain.id, from: report.from, to: report.to, rows: tab === 'days' ? report.days.length : report.people.length },
  });
  return { filename: csvFilename('prayer', tab === 'days' ? 'days' : 'people', report.from, 'to', report.to), csv };
}
