'use server';

import { revalidatePath } from 'next/cache';
import { cancelPeopleImport, commitPeopleImport } from '@/server/modules/import/people-import.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export async function commitImportAction(jobId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => commitPeopleImport(getDb(), ctx, { jobId }));
  revalidatePath(`/app/people/import/${jobId}`);
  if (result.ok) revalidatePath('/app/people');
  return result;
}

export async function cancelImportAction(jobId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => cancelPeopleImport(getDb(), ctx, { jobId }));
  revalidatePath(`/app/people/import/${jobId}`);
  return result;
}
