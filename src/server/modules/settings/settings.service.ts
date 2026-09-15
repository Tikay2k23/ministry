import { eq } from 'drizzle-orm';
import type { RequestContext } from '../../context/request-context';
import { actorUserId } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { systemSettings } from '../../db/schema';
import { validationError } from '../../errors';
import { assertGlobal } from '../../policy/can';
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

export async function updateSetting<K extends SettingKey>(
  db: Database,
  ctx: RequestContext,
  key: K,
  input: unknown,
): Promise<SettingValue<K>> {
  assertGlobal(ctx, 'settings.manage');
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
