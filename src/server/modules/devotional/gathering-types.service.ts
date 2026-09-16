import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { gatheringSchedules, gatheringScheduleTeams, gatheringTypeRoles, gatheringTypes, ministries, servingRoles, teams } from '../../db/schema';
import { forbidden, notFound, validationError } from '../../errors';
import { canAccessGatheringType, grantsFor, hasGlobal, hasPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { changedFields, recordAudit } from '../audit/audit.service';
import { localDate } from '../journal/journal-dates';
import { gatheringTypeForActor, loadGatheringType, ministryTimeZone } from './common';
import { listWorshipCoordinators } from './coordinators.service';
import { CreateGatheringTypeInput, describeGatheringSchedule, RosterTemplateInput, UpdateGatheringTypeInput } from './devotional.schemas';
import { keyFromName, uniqueKey } from './keys';

/**
 * Kinds of gatherings and their roster templates (FR-DEV-01, docs/05 W8 step 1, docs/04 A21):
 * "Morning Devotional, 6:00 AM for an hour, needs a Worship Leader, a Keyboard, two Backup Vocals…".
 */

/** New types: a global grant, or a ministry grant for the type's ministry. */
function canCreateFor(ctx: RequestContext, ministryId: string | null | undefined) {
  return grantsFor(ctx, 'devotional.manage').some(
    (g) => g.scope.type === 'global' || (g.scope.type === 'ministry' && ministryId != null && g.scope.ministryId === ministryId),
  );
}

async function assertMinistryExists(executor: Executor, ministryId: string | null | undefined) {
  if (!ministryId) return;
  const [ministry] = await executor
    .select({ id: ministries.id })
    .from(ministries)
    .where(and(eq(ministries.id, ministryId), isNull(ministries.archivedAt)));
  if (!ministry) throw validationError({ ministryId: ['That ministry does not exist.'] });
}

export async function listGatheringTypes(db: Executor, ctx: RequestContext) {
  if (!hasPermission(ctx, 'devotional.view')) throw notFound('gathering types');
  const rows = await db
    .select({ type: gatheringTypes, ministryName: ministries.name })
    .from(gatheringTypes)
    .leftJoin(ministries, eq(ministries.id, gatheringTypes.ministryId))
    .orderBy(asc(gatheringTypes.name));
  return rows.map(({ type, ministryName }) => ({
    id: type.id,
    name: type.name,
    defaultStartTime: type.defaultStartTime.slice(0, 5),
    defaultDurationMinutes: type.defaultDurationMinutes,
    ministryId: type.ministryId,
    ministryName,
    responseLockHours: type.responseLockHours,
    isActive: type.isActive,
    canManage: canAccessGatheringType(ctx, 'devotional.manage', type),
  }));
}

/** Everything on a gathering type's setup page: template, schedules with their rotation, coordinators. */
export async function getGatheringTypeSetup(db: Database, ctx: RequestContext, gatheringTypeId: string) {
  if (!hasPermission(ctx, 'devotional.view')) throw notFound('gathering type');
  const type = await loadGatheringType(db, gatheringTypeId);
  if (!type) throw notFound('gathering type');
  const timeZone = await ministryTimeZone(db);
  const today = localDate(ctx.now, timeZone);

  const [template, schedules, coordinators, ministry] = await Promise.all([
    db
      .select({
        servingRoleId: gatheringTypeRoles.servingRoleId,
        name: servingRoles.name,
        isActive: servingRoles.isActive,
        minCount: gatheringTypeRoles.minCount,
        maxCount: gatheringTypeRoles.maxCount,
      })
      .from(gatheringTypeRoles)
      .innerJoin(servingRoles, eq(servingRoles.id, gatheringTypeRoles.servingRoleId))
      .where(eq(gatheringTypeRoles.gatheringTypeId, type.id))
      .orderBy(asc(gatheringTypeRoles.sortOrder)),
    db.select().from(gatheringSchedules).where(eq(gatheringSchedules.gatheringTypeId, type.id)).orderBy(asc(gatheringSchedules.createdAt)),
    listWorshipCoordinators(db, type.id),
    type.ministryId ? db.select({ name: ministries.name }).from(ministries).where(eq(ministries.id, type.ministryId)) : Promise.resolve([]),
  ]);
  const rotation =
    schedules.length > 0
      ? await db
          .select({ scheduleId: gatheringScheduleTeams.scheduleId, teamId: gatheringScheduleTeams.teamId, teamName: teams.name })
          .from(gatheringScheduleTeams)
          .innerJoin(teams, eq(teams.id, gatheringScheduleTeams.teamId))
          .where(inArray(gatheringScheduleTeams.scheduleId, schedules.map((s) => s.id)))
          .orderBy(asc(gatheringScheduleTeams.position))
      : [];

  return {
    type: {
      id: type.id,
      name: type.name,
      defaultStartTime: type.defaultStartTime.slice(0, 5),
      defaultDurationMinutes: type.defaultDurationMinutes,
      ministryId: type.ministryId,
      ministryName: ministry[0]?.name ?? null,
      responseLockHours: type.responseLockHours,
      isActive: type.isActive,
    },
    template,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      description: describeGatheringSchedule(schedule),
      rotationMode: schedule.rotationMode,
      rotationAnchor: schedule.rotationAnchor,
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
      generateDaysAhead: schedule.generateDaysAhead,
      active: schedule.isActive && (schedule.effectiveTo === null || schedule.effectiveTo >= today),
      teams: rotation.filter((r) => r.scheduleId === schedule.id).map((r) => ({ teamId: r.teamId, name: r.teamName })),
    })),
    coordinators,
    today,
    can: {
      manage: canAccessGatheringType(ctx, 'devotional.manage', type),
      appointCoordinators: hasGlobal(ctx, 'iam.users.manage'),
    },
  };
}

/** Ministries the actor may add gathering types for. */
export async function gatheringTypeCreationOptions(db: Executor, ctx: RequestContext) {
  const grants = grantsFor(ctx, 'devotional.manage');
  const global = grants.some((g) => g.scope.type === 'global');
  const ministryIds = grants.flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : []));
  if (!global && ministryIds.length === 0) return { canCreate: false, requiresMinistry: true, ministries: [] };
  const rows = await db.select({ id: ministries.id, name: ministries.name }).from(ministries).where(isNull(ministries.archivedAt)).orderBy(asc(ministries.name));
  return { canCreate: true, requiresMinistry: !global, ministries: global ? rows : rows.filter((m) => ministryIds.includes(m.id)) };
}

export async function createGatheringType(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateGatheringTypeInput, raw);
  if (!canCreateFor(ctx, input.ministryId)) throw forbidden('You can add gatherings only for a ministry you manage.');
  return db.transaction(async (tx) => {
    await assertMinistryExists(tx, input.ministryId);
    const key = await uniqueKey(keyFromName(input.name, 'gathering'), async (candidate) => {
      const [row] = await tx.select({ id: gatheringTypes.id }).from(gatheringTypes).where(eq(gatheringTypes.key, candidate));
      return !row;
    });
    const [type] = await tx
      .insert(gatheringTypes)
      .values({
        key,
        name: input.name,
        defaultStartTime: `${input.defaultStartTime}:00`,
        defaultDurationMinutes: input.defaultDurationMinutes,
        ministryId: input.ministryId ?? null,
        responseLockHours: input.responseLockHours,
      })
      .returning({ id: gatheringTypes.id });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.gathering_type_created',
      entityType: 'gathering_type',
      entityId: type!.id,
      newValues: { key, name: input.name, ministryId: input.ministryId ?? null },
    });
    return { gatheringTypeId: type!.id };
  });
}

export async function updateGatheringType(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdateGatheringTypeInput, raw);
  return db.transaction(async (tx) => {
    const type = await gatheringTypeForActor(tx, ctx, 'devotional.manage', input.gatheringTypeId, { forUpdate: true });
    if ((input.ministryId ?? null) !== type.ministryId && !canCreateFor(ctx, input.ministryId)) {
      throw forbidden('You can move a gathering only into a ministry you manage.');
    }
    await assertMinistryExists(tx, input.ministryId);
    const next = {
      name: input.name,
      defaultStartTime: `${input.defaultStartTime}:00`,
      defaultDurationMinutes: input.defaultDurationMinutes,
      ministryId: input.ministryId ?? null,
      responseLockHours: input.responseLockHours,
      isActive: input.isActive,
    };
    await tx.update(gatheringTypes).set({ ...next, updatedAt: ctx.now }).where(eq(gatheringTypes.id, type.id));
    const diff = changedFields(type as unknown as Record<string, unknown>, next);
    if (diff) {
      await recordAudit(tx, ctx, { category: 'change', action: 'devotional.gathering_type_updated', entityType: 'gathering_type', entityId: type.id, ...diff });
    }
    return { gatheringTypeId: type.id };
  });
}

/** Replaces the roster template. Existing rosters keep their people; new gatherings use the new template. */
export async function setRosterTemplate(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(RosterTemplateInput, raw);
  return db.transaction(async (tx) => {
    const type = await gatheringTypeForActor(tx, ctx, 'devotional.manage', input.gatheringTypeId, { forUpdate: true });
    const roleIds = input.roles.map((r) => r.servingRoleId);
    if (roleIds.length > 0) {
      const found = await tx
        .select({ id: servingRoles.id })
        .from(servingRoles)
        .where(and(inArray(servingRoles.id, roleIds), eq(servingRoles.isActive, true)));
      if (found.length !== roleIds.length) throw validationError({ roles: ['Choose serving roles that are in use.'] });
    }
    await tx.delete(gatheringTypeRoles).where(eq(gatheringTypeRoles.gatheringTypeId, type.id));
    if (input.roles.length > 0) {
      await tx.insert(gatheringTypeRoles).values(
        input.roles.map((role, sortOrder) => ({ gatheringTypeId: type.id, servingRoleId: role.servingRoleId, minCount: role.minCount, maxCount: role.maxCount, sortOrder })),
      );
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.roster_template_set',
      entityType: 'gathering_type',
      entityId: type.id,
      newValues: { roles: input.roles.length },
    });
    return { roles: input.roles.length };
  });
}
