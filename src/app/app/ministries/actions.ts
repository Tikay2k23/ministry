'use server';

import { revalidatePath } from 'next/cache';
import {
  createDepartment,
  createMinistry,
  createTeam,
  endMinistryMembership,
} from '@/server/modules/ministries/ministries.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

export async function createMinistryAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const result = await runAction(() =>
    createMinistry(getDb(), ctx, {
      name: text(formData, 'name'),
      code: text(formData, 'code'),
      description: text(formData, 'description') || undefined,
    }),
  );
  if (result.ok) revalidatePath('/app/ministries');
  return result;
}

export async function createDepartmentAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const ministryId = text(formData, 'ministryId');
  const result = await runAction(() => createDepartment(getDb(), ctx, { ministryId, name: text(formData, 'name') }));
  if (result.ok) revalidatePath(`/app/ministries/${ministryId}`);
  return result;
}

export async function createTeamAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const ministryId = text(formData, 'ministryId');
  const result = await runAction(() =>
    createTeam(getDb(), ctx, {
      ministryId,
      departmentId: text(formData, 'departmentId'),
      name: text(formData, 'name'),
      teamType: text(formData, 'teamType') || undefined,
    }),
  );
  if (result.ok) revalidatePath(`/app/ministries/${ministryId}`);
  return result;
}

export async function endMembershipAction(membershipId: string, ministryId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => endMinistryMembership(getDb(), ctx, { membershipId }));
  if (result.ok) revalidatePath(`/app/ministries/${ministryId}`);
  return result;
}
