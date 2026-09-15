'use server';

import { revalidatePath } from 'next/cache';
import { movePerson, placePerson } from '@/server/modules/hierarchy/hierarchy.service';
import { requestLeaderChange } from '@/server/modules/hierarchy/leader-change.service';
import { assignRole, findAccountForPerson, inviteUser, revokeRole } from '@/server/modules/iam/users.service';
import { addMinistryMember } from '@/server/modules/ministries/ministries.service';
import { archivePerson } from '@/server/modules/people/people.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

export async function grantAccessAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const personId = text(formData, 'personId');
  const result = await runAction(async () => {
    const db = getDb();
    const roleKey = text(formData, 'roleKey');
    const scopeMinistryId = text(formData, 'scopeMinistryId') || undefined;
    const account = await findAccountForPerson(db, personId);
    if (account) {
      await assignRole(db, ctx, { userId: account.id, roleKey, scopeMinistryId });
      return { invited: false };
    }
    await inviteUser(db, ctx, { personId, email: text(formData, 'email'), roleKey, scopeMinistryId });
    return { invited: true };
  });
  if (result.ok) revalidatePath(`/app/people/${personId}`);
  return result;
}

export async function revokeRoleAction(assignmentId: string, personId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => revokeRole(getDb(), ctx, { assignmentId }));
  if (result.ok) revalidatePath(`/app/people/${personId}`);
  return result;
}

export async function addMembershipAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const personId = text(formData, 'personId');
  const result = await runAction(() =>
    addMinistryMember(getDb(), ctx, {
      personId,
      ministryId: text(formData, 'ministryId'),
      departmentId: text(formData, 'departmentId'),
      position: text(formData, 'position') || undefined,
      isPrimary: formData.get('isPrimary') === 'on',
    }),
  );
  if (result.ok) revalidatePath(`/app/people/${personId}`);
  return result;
}

export async function changeLeaderAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const personId = text(formData, 'personId');
  const intent = text(formData, 'intent');
  const leaderId = text(formData, 'leaderId');
  const reason = text(formData, 'reason') || undefined;
  const db = getDb();

  const result = await runAction(async () => {
    if (intent === 'place') {
      await placePerson(db, ctx, { personId, leaderId: leaderId || null, reason });
      return { outcome: 'placed' as const };
    }
    if (intent === 'request') {
      await requestLeaderChange(db, ctx, { personId, toLeaderId: leaderId, reason });
      return { outcome: 'requested' as const };
    }
    const expected = text(formData, 'expectedLeaderId');
    await movePerson(db, ctx, {
      personId,
      newLeaderId: leaderId || null,
      mode: text(formData, 'mode') || 'with_subtree',
      groupNewLeaderId: text(formData, 'groupNewLeaderId') || undefined,
      reason,
      expectedLeaderId: expected === '' ? null : expected,
    });
    return { outcome: 'moved' as const };
  });
  if (result.ok) {
    revalidatePath(`/app/people/${personId}`);
    revalidatePath('/app/leadership');
  }
  return result;
}

export async function archivePersonAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const personId = text(formData, 'personId');
  const result = await runAction(() =>
    archivePerson(getDb(), ctx, { personId, reason: text(formData, 'reason'), note: text(formData, 'note') || undefined }),
  );
  if (result.ok) revalidatePath(`/app/people/${personId}`);
  return result;
}
