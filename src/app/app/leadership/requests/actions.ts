'use server';

import { revalidatePath } from 'next/cache';
import { decideLeaderChangeRequest } from '@/server/modules/hierarchy/leader-change.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function decideRequestAction(requestId: string, decision: 'approve' | 'reject', note: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() =>
    decideLeaderChangeRequest(getDb(), ctx, { requestId, decision, note: note.trim() || undefined }),
  );
  revalidatePath('/app/leadership/requests');
  revalidatePath('/app/leadership');
  return result;
}
