'use server';

import { revalidatePath } from 'next/cache';
import { createPerson, updatePerson } from '@/server/modules/people/people.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

/** Maps the person form to service input. Fields that weren't rendered stay undefined (unchanged). */
function personFields(formData: FormData) {
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    firstName: value('firstName'),
    lastName: value('lastName'),
    middleName: value('middleName'),
    preferredName: value('preferredName'),
    suffix: value('suffix'),
    phone: value('phone'),
    email: value('email'),
    birthMonth: value('birthMonth'),
    birthDay: value('birthDay'),
    birthYear: value('birthYear'),
    gender: value('gender'),
    joinedOn: value('joinedOn'),
    addressLine: value('addressLine'),
    city: value('city'),
    province: value('province'),
    journalExpected: formData.has('journalExpectedPresent') ? formData.get('journalExpected') === 'on' : undefined,
    designations: formData.has('designationsPresent') ? formData.getAll('designations').map(String) : undefined,
  };
}

export async function createPersonAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const result = await runAction(() =>
    createPerson(getDb(), ctx, {
      ...personFields(formData),
      leaderId: formData.get('leaderId') || null,
      acceptsMembers: formData.get('acceptsMembers') === 'on',
      confirmNotDuplicate: formData.get('confirmNotDuplicate') === 'true',
    }),
  );
  if (result.ok) revalidatePath('/app/people');
  return result;
}

export async function updatePersonAction(formData: FormData) {
  const { ctx } = await requirePortal();
  const personId = String(formData.get('personId') ?? '');
  const result = await runAction(() =>
    updatePerson(getDb(), ctx, {
      ...personFields(formData),
      personId,
      expectedUpdatedAt: formData.get('expectedUpdatedAt'),
      status: formData.get('status') || undefined,
    }),
  );
  if (result.ok) {
    revalidatePath('/app/people');
    revalidatePath(`/app/people/${personId}`);
  }
  return result;
}
