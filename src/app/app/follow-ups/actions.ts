'use server';

import { revalidatePath } from 'next/cache';
import { updateFollowUp } from '@/server/modules/care/care.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function updateFollowUpAction(input: {
  followUpId: string;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  note?: string;
  assignToMe?: boolean;
}) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => updateFollowUp(getDb(), ctx, input));
  if (result.ok) {
    revalidatePath('/app/follow-ups');
    revalidatePath('/app/journal', 'layout');
  }
  return result;
}
