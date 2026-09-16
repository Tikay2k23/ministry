'use server';

import { revalidatePath } from 'next/cache';
import { markNotificationsRead } from '@/server/modules/notifications/notifications.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

/** Marks the user's own notifications read: `{ ids }` or `{ all: true }` (docs/04 A24). */
export async function markReadAction(input: unknown) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => markNotificationsRead(getDb(), ctx, input));
  // The unread count sits in the portal navigation.
  if (result.ok) revalidatePath('/app', 'layout');
  return result;
}
