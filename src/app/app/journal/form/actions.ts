'use server';

import { revalidatePath } from 'next/cache';
import {
  discardFormDraft,
  JOURNAL_FORM_KEY,
  publishFormDraft,
  saveFormDraft,
  type FieldInputValue,
} from '@/server/modules/forms/forms.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function saveDraftAction(fields: FieldInputValue[]) {
  const { ctx } = await requirePortal();
  const result = await runAction(async () => {
    await saveFormDraft(getDb(), ctx, { formKey: JOURNAL_FORM_KEY, fields });
    return { saved: true };
  });
  if (result.ok) revalidatePath('/app/journal/form');
  return result;
}

export async function publishDraftAction() {
  const { ctx } = await requirePortal();
  const result = await runAction(async () => {
    await publishFormDraft(getDb(), ctx, { formKey: JOURNAL_FORM_KEY });
    return { published: true };
  });
  if (result.ok) revalidatePath('/app/journal/form');
  return result;
}

export async function discardDraftAction() {
  const { ctx } = await requirePortal();
  const result = await runAction(async () => {
    await discardFormDraft(getDb(), ctx, { formKey: JOURNAL_FORM_KEY });
    return { discarded: true };
  });
  if (result.ok) revalidatePath('/app/journal/form');
  return result;
}
