import { asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { actorUserId } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { leadershipLevels, systemSettings } from '../../db/schema';
import { AppError, notFound, validationError } from '../../errors';
import type { PermissionKey } from '../../policy/catalog';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { SETTINGS, type SettingKey, type SettingValue } from './definitions';

/** Reads a setting, falling back to its default when missing or no longer valid. */
export async function getSetting<K extends SettingKey>(executor: Executor, key: K): Promise<SettingValue<K>> {
  const [row] = await executor.select().from(systemSettings).where(eq(systemSettings.key, key));
  const definition = SETTINGS[key];
  if (!row) return definition.defaults as SettingValue<K>;
  const parsed = definition.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : definition.defaults) as SettingValue<K>;
}

/**
 * Who may change each setting (docs/06 rows 10, 20, 35). Journal policy belongs to the pastors as
 * well as the administrators; everything else needs `settings.manage`, which requires 2FA.
 */
const SETTING_PERMISSIONS: Partial<Record<SettingKey, PermissionKey>> = {
  'journal.policy': 'journal.settings.manage',
};

export function settingPermission(key: SettingKey): PermissionKey {
  return SETTING_PERMISSIONS[key] ?? 'settings.manage';
}

export async function updateSetting<K extends SettingKey>(
  db: Database,
  ctx: RequestContext,
  key: K,
  input: unknown,
): Promise<SettingValue<K>> {
  if (!Object.hasOwn(SETTINGS, key)) throw notFound('setting');
  assertGlobal(ctx, settingPermission(key));
  const parsed = SETTINGS[key].schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '_';
      (fieldErrors[path] ??= []).push(issue.message);
    }
    throw validationError(fieldErrors);
  }
  const value = parsed.data as SettingValue<K>;

  return db.transaction(async (tx) => {
    const before = await getSetting(tx, key);
    // Letting more leaders read journal answers is a pastoral decision: only from a verified session.
    if (key === 'journal.policy') {
      const widens = (value as SettingValue<'journal.policy'>).contentVisibilityDepth > (before as SettingValue<'journal.policy'>).contentVisibilityDepth;
      if (widens && !(ctx.actor.kind === 'user' && ctx.actor.twoFactorVerified)) {
        throw new AppError('FORBIDDEN', 'Turn on two-step verification before letting more leaders read journal answers.');
      }
    }
    await tx
      .insert(systemSettings)
      .values({ key, value, updatedBy: actorUserId(ctx), updatedAt: ctx.now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedBy: actorUserId(ctx), updatedAt: ctx.now },
      });
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'settings.updated',
      entityType: 'setting',
      entityId: key,
      oldValues: before as Record<string, unknown>,
      newValues: value as Record<string, unknown>,
    });
    return value;
  });
}

// ─── Leadership level names (docs/01 FR-LDR-02, docs/06 row 10) ─────────────────

export async function listLeadershipLevels(executor: Executor) {
  return executor
    .select({ depth: leadershipLevels.depth, name: leadershipLevels.name, pluralName: leadershipLevels.pluralName, description: leadershipLevels.description })
    .from(leadershipLevels)
    .orderBy(asc(leadershipLevels.depth));
}

export const LeadershipLevelsInput = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Name this level').max(60),
        pluralName: z.string().trim().min(1, 'Add the plural').max(60),
        description: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, 'Keep at least one level')
    .max(12),
});

/** Replaces the level names, top (depth 0) first. Levels below the last one are removed. */
export async function saveLeadershipLevels(db: Database, ctx: RequestContext, raw: unknown) {
  assertGlobal(ctx, 'settings.manage');
  const { levels } = parseInput(LeadershipLevelsInput, raw);
  return db.transaction(async (tx) => {
    const before = await listLeadershipLevels(tx);
    for (const [depth, level] of levels.entries()) {
      const values = { name: level.name, pluralName: level.pluralName, description: level.description || null, updatedAt: ctx.now };
      await tx.insert(leadershipLevels).values({ depth, ...values }).onConflictDoUpdate({ target: leadershipLevels.depth, set: values });
    }
    await tx.delete(leadershipLevels).where(gt(leadershipLevels.depth, levels.length - 1));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'settings.leadership_levels_updated',
      entityType: 'setting',
      entityId: 'leadership_levels',
      oldValues: { levels: before.map((l) => l.name) },
      newValues: { levels: levels.map((l) => l.name) },
    });
    return { levels: levels.length };
  });
}
