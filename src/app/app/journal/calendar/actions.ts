'use server';

import { revalidatePath } from 'next/cache';
import { removeCalendarDay, setCalendarDay } from '@/server/modules/journal/journal-calendar.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function setCalendarDayAction(input: { day: string; kind: string; excusesJournal: boolean; note?: string }) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => setCalendarDay(getDb(), ctx, input));
  if (result.ok) revalidatePath('/app/journal', 'layout');
  return result;
}

export async function removeCalendarDayAction(day: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => removeCalendarDay(getDb(), ctx, { day }));
  if (result.ok) revalidatePath('/app/journal', 'layout');
  return result;
}
