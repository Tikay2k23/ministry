import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { servingRoles } from '../../db/schema';
import { conflict, notFound } from '../../errors';
import { assertPermission, hasPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { changedFields, recordAudit } from '../audit/audit.service';
import { ServingRoleInput, UpdateServingRoleInput } from './devotional.schemas';
import { keyFromName, uniqueKey } from './keys';

/**
 * The serving-role vocabulary (FR-DEV-02, docs/04 A21): Worship Leader, Keyboard, Prayer Leader, …
 * It is shared by every gathering type, so anyone who manages worship teams keeps it tidy. Roles
 * are switched off rather than deleted, so past rosters keep their names.
 */

export async function listServingRoles(db: Executor, ctx: RequestContext) {
  if (!hasPermission(ctx, 'devotional.view') && !hasPermission(ctx, 'devotional.teams.manage')) throw notFound('serving roles');
  const rows = await db.select().from(servingRoles).orderBy(asc(servingRoles.sortOrder), asc(servingRoles.name));
  return rows.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    category: role.category,
    isActive: role.isActive,
  }));
}

async function assertNameFree(executor: Executor, name: string, exceptId?: string) {
  const [taken] = await executor
    .select({ id: servingRoles.id })
    .from(servingRoles)
    .where(and(sql`lower(${servingRoles.name}) = lower(${name})`, exceptId ? ne(servingRoles.id, exceptId) : undefined));
  if (taken) throw conflict('A serving role with this name already exists.');
}

export async function createServingRole(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ServingRoleInput, raw);
  assertPermission(ctx, 'devotional.teams.manage');
  return db.transaction(async (tx) => {
    await assertNameFree(tx, input.name);
    const key = await uniqueKey(keyFromName(input.name, 'role'), async (candidate) => {
      const [row] = await tx.select({ id: servingRoles.id }).from(servingRoles).where(eq(servingRoles.key, candidate));
      return !row;
    });
    const [last] = await tx.select({ max: sql<number>`coalesce(max(${servingRoles.sortOrder}), -1)` }).from(servingRoles);
    const [role] = await tx
      .insert(servingRoles)
      .values({ key, name: input.name, category: input.category, sortOrder: Number(last?.max ?? -1) + 1 })
      .returning({ id: servingRoles.id });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.serving_role_created',
      entityType: 'serving_role',
      entityId: role!.id,
      newValues: { key, name: input.name, category: input.category },
    });
    return { servingRoleId: role!.id };
  });
}

export async function updateServingRole(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdateServingRoleInput, raw);
  assertPermission(ctx, 'devotional.teams.manage');
  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(servingRoles).where(eq(servingRoles.id, input.servingRoleId)).for('update');
    if (!role) throw notFound('serving role');
    await assertNameFree(tx, input.name, role.id);
    const next = { name: input.name, category: input.category, isActive: input.isActive };
    await tx.update(servingRoles).set({ ...next, updatedAt: ctx.now }).where(eq(servingRoles.id, role.id));
    const diff = changedFields(role as unknown as Record<string, unknown>, next);
    if (diff) {
      await recordAudit(tx, ctx, { category: 'change', action: 'devotional.serving_role_updated', entityType: 'serving_role', entityId: role.id, ...diff });
    }
    return { servingRoleId: role.id };
  });
}
