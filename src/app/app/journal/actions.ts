'use server';

import { revalidatePath } from 'next/cache';
import { setDayExcused } from '@/server/modules/journal/journal-calendar.service';
import { reviewJournalEntry } from '@/server/modules/journal/journal-portal.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function reviewEntryAction(input: {
  entryId: string;
  personId: string;
  comment: string;
  followUp: 'none' | 'leadership' | 'pastoral';
}) {
  const { ctx } = await requirePortal();
  const result = await runAction(() =>
    reviewJournalEntry(getDb(), ctx, { entryId: input.entryId, comment: input.comment, followUp: input.followUp }),
  );
  if (result.ok) {
    revalidatePath('/app/journal', 'layout');
    revalidatePath('/app/follow-ups');
  }
  return result;
}

export async function excuseDayAction(input: { personId: string; journalDate: string; excused: boolean; note?: string }) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => setDayExcused(getDb(), ctx, input));
  if (result.ok) {
    revalidatePath('/app/journal', 'layout');
    revalidatePath(`/app/people/${input.personId}`);
  }
  return result;
}
