import { asc, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { formatSlotRange } from '@/lib/time-range';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import type { GatheringStatus } from '../../db/enums';
import { gatheringTypes } from '../../db/schema';
import { notFound } from '../../errors';
import { canAccessGatheringType, hasPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { addDays, localDate } from '../journal/journal-dates';
import { mondayOf } from '../scheduling/recurrence';
import { ministryTimeZone, shortDateLabel } from './common';

/**
 * The devotional calendar (docs/04 A19) and the dashboard card (FR-DEV-09): gatherings with their
 * team and reply counts (5 ✓ · 1 ◷ · 0 ✗), and required roles still open. Anyone with
 * `devotional.view` sees every gathering; actions depend on the gathering type.
 */

interface SummaryRow {
  id: string;
  occurs_on: string;
  starts_at: Date | string;
  ends_at: Date | string;
  title: string | null;
  status: GatheringStatus;
  roster_published_at: Date | string | null;
  team_name: string | null;
  type_id: string;
  type_name: string;
  ministry_id: string | null;
  confirmed: number;
  pending: number;
  declined: number;
  open_required: number;
}

async function gatheringSummaries(executor: Executor, where: SQL): Promise<SummaryRow[]> {
  return queryRows<SummaryRow>(
    executor,
    sql`SELECT g.id, g.occurs_on::text AS occurs_on, g.starts_at, g.ends_at, g.title, g.status, g.roster_published_at,
               t.name AS team_name, gt.id AS type_id, gt.name AS type_name, gt.ministry_id,
               (SELECT count(*)::int FROM gathering_assignments ga WHERE ga.gathering_id = g.id AND ga.status = 'confirmed') AS confirmed,
               (SELECT count(*)::int FROM gathering_assignments ga WHERE ga.gathering_id = g.id AND ga.status = 'pending') AS pending,
               (SELECT count(*)::int FROM gathering_assignments ga WHERE ga.gathering_id = g.id AND ga.status = 'declined') AS declined,
               (SELECT coalesce(sum(greatest(gtr.min_count - (SELECT count(*) FROM gathering_assignments gx
                                                               WHERE gx.gathering_id = g.id AND gx.serving_role_id = gtr.serving_role_id
                                                                 AND gx.status IN ('pending', 'confirmed')), 0)), 0)::int
                  FROM gathering_type_roles gtr
                  JOIN serving_roles sr ON sr.id = gtr.serving_role_id AND sr.is_active
                 WHERE gtr.gathering_type_id = g.gathering_type_id) AS open_required
          FROM gatherings g
          JOIN gathering_types gt ON gt.id = g.gathering_type_id
          LEFT JOIN teams t ON t.id = g.team_id
         WHERE ${where}
         ORDER BY g.starts_at`,
  );
}

function toSummary(row: SummaryRow, ctx: RequestContext, timeZone: string) {
  const startsAt = new Date(row.starts_at);
  const endsAt = new Date(row.ends_at);
  const isOver = endsAt <= ctx.now;
  const scheduled = row.status === 'scheduled';
  const openRequired = Number(row.open_required);
  const declined = Number(row.declined);
  return {
    id: row.id,
    occursOn: row.occurs_on,
    name: row.title ?? row.type_name,
    typeName: row.type_name,
    dateLabel: shortDateLabel(startsAt, timeZone),
    timeLabel: formatSlotRange(startsAt, endsAt, timeZone),
    teamName: row.team_name,
    status: row.status,
    published: row.roster_published_at !== null,
    confirmed: Number(row.confirmed),
    pending: Number(row.pending),
    declined,
    openRequired,
    isOver,
    needsAttention: scheduled && !isOver && (openRequired > 0 || declined > 0),
    canManage: scheduled && !isOver && canAccessGatheringType(ctx, 'devotional.manage', { id: row.type_id, ministryId: row.ministry_id }),
  };
}

export const CalendarInput = z.object({
  week: z.iso.date().optional().catch(undefined),
  gatheringTypeId: z.uuid().optional().catch(undefined),
  attention: z.preprocess((v) => v === true || v === '1' || v === 'true', z.boolean()).catch(false),
});

/** A week of gatherings, Monday to Sunday. */
export async function getDevotionalCalendar(db: Database, ctx: RequestContext, raw: unknown) {
  if (!hasPermission(ctx, 'devotional.view')) throw notFound('devotional calendar');
  const input = parseInput(CalendarInput, raw ?? {});
  const timeZone = await ministryTimeZone(db);
  const today = localDate(ctx.now, timeZone);
  const weekStart = mondayOf(input.week ?? today);
  const weekEnd = addDays(weekStart, 6);

  const [types, rows] = await Promise.all([
    db.select({ id: gatheringTypes.id, name: gatheringTypes.name, ministryId: gatheringTypes.ministryId, isActive: gatheringTypes.isActive }).from(gatheringTypes).orderBy(asc(gatheringTypes.name)),
    gatheringSummaries(
      db,
      sql`g.occurs_on BETWEEN ${weekStart}::date AND ${weekEnd}::date ${input.gatheringTypeId ? sql`AND g.gathering_type_id = ${input.gatheringTypeId}::uuid` : sql``}`,
    ),
  ]);
  const items = rows.map((row) => toSummary(row, ctx, timeZone)).filter((item) => !input.attention || item.needsAttention);

  return {
    weekStart,
    weekEnd,
    today,
    previousWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    filters: { gatheringTypeId: input.gatheringTypeId ?? null, attention: input.attention },
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, isToday: date === today, gatherings: items.filter((item) => item.occursOn === date) };
    }),
    types: types.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name })),
    /** Draft rosters this person may publish ("Publish this week"). */
    unpublishedIds: items.filter((item) => item.canManage && !item.published).map((item) => item.id),
    can: {
      manage: types.some((t) => canAccessGatheringType(ctx, 'devotional.manage', t)),
      setup: types.some((t) => canAccessGatheringType(ctx, 'devotional.manage', t)) || hasPermission(ctx, 'devotional.teams.manage'),
    },
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The dashboard card (FR-DEV-09): the next few gatherings, and what needs the coordinator. */
export async function getDevotionalOverview(db: Database, ctx: RequestContext) {
  if (!hasPermission(ctx, 'devotional.view')) return null;
  const timeZone = await ministryTimeZone(db);
  const now = ctx.now.toISOString();
  const rows = await gatheringSummaries(
    db,
    sql`g.status = 'scheduled' AND g.ends_at > ${now}::timestamptz AND g.starts_at <= ${new Date(ctx.now.getTime() + 7 * 86_400_000).toISOString()}::timestamptz`,
  );
  const items = rows.map((row) => toSummary(row, ctx, timeZone));
  const soon = new Date(ctx.now.getTime() + 3 * 86_400_000);

  const attention: { href: string; label: string }[] = [];
  for (const item of items.filter((i) => i.canManage)) {
    const href = `/app/devotional/${item.id}`;
    if (item.openRequired > 0 && new Date(rows.find((r) => r.id === item.id)!.starts_at) <= new Date(ctx.now.getTime() + 2 * 86_400_000)) {
      attention.push({ href, label: `${item.name}, ${item.dateLabel}: ${plural(item.openRequired, 'role still open', 'roles still open')}` });
    }
    if (item.declined > 0) {
      attention.push({ href, label: `${item.name}, ${item.dateLabel}: ${plural(item.declined, 'person can’t serve', 'people can’t serve')}` });
    }
  }
  return {
    upcoming: items.filter((item) => new Date(rows.find((r) => r.id === item.id)!.starts_at) <= soon).slice(0, 3),
    attention: attention.slice(0, 4),
  };
}
