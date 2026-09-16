import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Executor } from '../../db/client';
import { careFollowups, gatherings, gatheringTypes } from '../../db/schema';
import { notFound } from '../../errors';
import { assertGatheringTypeAccess, hasPermission, type GatheringTypeRef } from '../../policy/can';
import type { PermissionKey } from '../../policy/catalog';
import { getSetting } from '../settings/settings.service';

/** Shared helpers for the devotional module (docs/03 §4.12, docs/05 W8, W9 and W14). */

export type GatheringTypeRow = typeof gatheringTypes.$inferSelect;
export type GatheringRow = typeof gatherings.$inferSelect;

/** Gatherings use the ministry's time zone (single tenant, docs/README D1–D10). */
export async function ministryTimeZone(executor: Executor): Promise<string> {
  return (await getSetting(executor, 'ministry.profile')).timezone;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export async function loadGatheringType(executor: Executor, typeId: string, options: { forUpdate?: boolean } = {}): Promise<GatheringTypeRow | null> {
  if (!isUuid(typeId)) return null;
  const query = executor.select().from(gatheringTypes).where(eq(gatheringTypes.id, typeId));
  const [type] = options.forUpdate ? await query.for('update') : await query;
  return type ?? null;
}

/** A gathering type the actor may act on with `permission`; otherwise NOT_FOUND (docs/06 T14). */
export async function gatheringTypeForActor(
  executor: Executor,
  ctx: RequestContext,
  permission: PermissionKey,
  typeId: string,
  options: { forUpdate?: boolean } = {},
): Promise<GatheringTypeRow> {
  const type = await loadGatheringType(executor, typeId, options);
  if (!type) throw notFound('gathering type');
  assertGatheringTypeAccess(ctx, permission, type);
  return type;
}

export async function loadGathering(executor: Executor, gatheringId: string, options: { forUpdate?: boolean } = {}) {
  if (!isUuid(gatheringId)) return null;
  const query = executor
    .select({ gathering: gatherings, type: gatheringTypes })
    .from(gatherings)
    .innerJoin(gatheringTypes, eq(gatheringTypes.id, gatherings.gatheringTypeId))
    .where(eq(gatherings.id, gatheringId));
  const [row] = options.forUpdate ? await query.for('update', { of: gatherings }) : await query;
  return row ?? null;
}

/**
 * A gathering the actor may act on. Viewing needs only `devotional.view` in any scope (docs/06
 * row 29); managing needs the permission for the gathering's type. Otherwise NOT_FOUND.
 */
export async function gatheringForActor(
  executor: Executor,
  ctx: RequestContext,
  permission: PermissionKey,
  gatheringId: string,
  options: { forUpdate?: boolean } = {},
) {
  const row = await loadGathering(executor, gatheringId, options);
  if (!row) throw notFound('gathering');
  if (permission === 'devotional.view') {
    if (!hasPermission(ctx, 'devotional.view')) throw notFound('gathering');
  } else {
    assertGatheringTypeAccess(ctx, permission, row.type);
  }
  return row;
}

export const gatheringName = (type: { name: string }, gathering: { title: string | null }) => gathering.title ?? type.name;

/** "Saturday, September 12". */
export const longDateLabel = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(instant);

/** "Sat, Sep 12". */
export const shortDateLabel = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(instant);

/** "6:00 AM". */
export const clockLabel = (instant: Date, timeZone: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone }).format(instant);

/** "Grace M." — how people are named to coordinators in notices. */
export const shortPersonName = (person: { firstName: string; lastName: string; preferredName: string | null }) =>
  `${person.preferredName ?? person.firstName} ${person.lastName.charAt(0)}.`;

// ─── Follow-ups when someone can't serve (docs/05 W9 step 2′) ─────────────────

export const servingFollowUpKey = (assignmentId: string) => `serving_declined:${assignmentId}`;

export async function closeServingFollowUps(executor: Executor, assignmentIds: string[], input: { note: string | null; resolvedBy: string | null; now: Date }) {
  if (assignmentIds.length === 0) return;
  await executor
    .update(careFollowups)
    .set({ status: 'resolved', resolutionNote: input.note, resolvedBy: input.resolvedBy, resolvedAt: input.now, updatedAt: input.now })
    .where(and(inArray(careFollowups.dedupeKey, assignmentIds.map(servingFollowUpKey)), inArray(careFollowups.status, ['open', 'in_progress'])));
}

// ─── Coordinators ─────────────────────────────────────────────────────────────

/**
 * Portal users who run a gathering type: those holding `devotional.manage` for the type itself or
 * its ministry — or, when nobody does, globally.
 */
export async function devotionalCoordinatorUserIds(executor: Executor, type: GatheringTypeRef): Promise<string[]> {
  const rows = await queryRows<{ user_id: string; scope_type: string }>(
    executor,
    sql`SELECT DISTINCT ura.user_id, ura.scope_type
          FROM user_role_assignments ura
          JOIN roles r ON r.id = ura.role_id AND r.archived_at IS NULL
          JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission_key = 'devotional.manage'
          JOIN users u ON u.id = ura.user_id AND u.status IN ('active', 'invited')
         WHERE ura.revoked_at IS NULL
           AND (ura.expires_at IS NULL OR ura.expires_at > now())
           AND (ura.scope_type = 'global'
                OR (ura.scope_type = 'gathering_type' AND ura.scope_gathering_type_id = ${type.id}::uuid)
                OR (ura.scope_type = 'ministry' AND ura.scope_ministry_id = ${type.ministryId}::uuid))`,
  );
  const specific = rows.filter((row) => row.scope_type !== 'global');
  return [...new Set((specific.length > 0 ? specific : rows).map((row) => row.user_id))];
}
