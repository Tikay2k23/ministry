'use server';

import { revalidatePath } from 'next/cache';
import { resolveDuplicateCandidate } from '@/server/modules/people/people.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function dismissDuplicateAction(candidateId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => resolveDuplicateCandidate(getDb(), ctx, { candidateId, decision: 'not_duplicate' }));
  if (result.ok) revalidatePath('/app/people/review');
  return result;
}
