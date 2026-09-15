'use server';

import { revalidatePath } from 'next/cache';
import { deactivateUser, inviteUser } from '@/server/modules/iam/users.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import type { Result } from '@/server/errors';

export async function inviteUserAction(_prev: Result<{ email: string }> | null, formData: FormData) {
  const { ctx } = await requirePortal();
  const result = await runAction(async () => {
    const input = {
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      email: String(formData.get('email') ?? ''),
      roleKey: String(formData.get('roleKey') ?? ''),
    };
    await inviteUser(getDb(), ctx, input);
    return { email: input.email };
  });
  if (result.ok) revalidatePath('/app/admin/users');
  return result;
}

export async function deactivateUserAction(userId: string, reason: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => deactivateUser(getDb(), ctx, { userId, reason }));
  if (result.ok) revalidatePath('/app/admin/users');
  return result;
}
