'use server';

import { revalidatePath } from 'next/cache';
import type { SettingKey } from '@/server/modules/settings/definitions';
import { runJobSoon } from '@/server/modules/settings/health.service';
import { saveLeadershipLevels, updateSetting } from '@/server/modules/settings/settings.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

/**
 * Server actions for Settings and System health (docs/04 A26, A29). The services check the
 * permission for each setting; these only connect the pages to them.
 */

export async function updateSettingAction(key: SettingKey, input: unknown) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => updateSetting(getDb(), ctx, key, input));
  if (result.ok) revalidatePath('/app', 'layout');
  return result;
}

export async function saveLeadershipLevelsAction(input: unknown) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => saveLeadershipLevels(getDb(), ctx, input));
  if (result.ok) revalidatePath('/app', 'layout');
  return result;
}

export async function runJobSoonAction(input: unknown) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => runJobSoon(getDb(), ctx, input));
  if (result.ok) revalidatePath('/app/admin/health');
  return result;
}
