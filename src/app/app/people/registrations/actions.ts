'use server';

import { revalidatePath } from 'next/cache';
import { decideRegistration } from '@/server/modules/people/registrations.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function decideRegistrationAction(personId: string, decision: 'confirm' | 'decline', note: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => decideRegistration(getDb(), ctx, { personId, decision, note }));
  if (result.ok) {
    revalidatePath('/app/people/registrations');
    revalidatePath('/app/people');
    revalidatePath(`/app/people/${personId}`);
    revalidatePath('/app/journal', 'layout');
  }
  return result;
}
