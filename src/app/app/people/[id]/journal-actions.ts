'use server';

import { revalidatePath } from 'next/cache';
import { addPause, endPause } from '@/server/modules/journal/journal-calendar.service';
import { submitJournalByProxy } from '@/server/modules/journal/journal-submit.service';
import { rotateLeaderJournalCode } from '@/server/modules/public/entry-codes.service';
import { issuePersonalLink, revokeParticipantKeys } from '@/server/modules/public/participants.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

function refreshPerson(personId: string) {
  revalidatePath(`/app/people/${personId}`);
  revalidatePath('/app/journal', 'layout');
}

export async function addPauseAction(input: { personId: string; startsOn: string; endsOn?: string; reason: string; note?: string }) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => addPause(getDb(), ctx, input));
  if (result.ok) refreshPerson(input.personId);
  return result;
}

export async function endPauseAction(personId: string, pauseId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => endPause(getDb(), ctx, { pauseId }));
  if (result.ok) refreshPerson(personId);
  return result;
}

export async function issuePersonalLinkAction(personId: string) {
  const { ctx } = await requirePortal();
  return runAction(() => issuePersonalLink(getDb(), ctx, { personId }));
}

export async function revokeDevicesAction(personId: string) {
  const { ctx } = await requirePortal();
  return runAction(() => revokeParticipantKeys(getDb(), ctx, { personId }));
}

export async function rotateJournalCodeAction(personId: string) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => rotateLeaderJournalCode(getDb(), ctx, { personId }));
  if (result.ok) revalidatePath(`/app/people/${personId}/qr`);
  return result;
}

export async function submitProxyJournalAction(input: {
  personId: string;
  journalDate: string;
  formVersionId: string;
  idempotencyKey: string;
  answers: Record<string, unknown>;
}) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => submitJournalByProxy(getDb(), ctx, input));
  if (result.ok) refreshPerson(input.personId);
  return result;
}
