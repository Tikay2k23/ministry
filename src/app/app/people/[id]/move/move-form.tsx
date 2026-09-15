'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { PersonPicker } from '@/components/portal/person-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { changeLeaderAction } from '../actions';

export function MoveForm({
  intent,
  personId,
  personFirstName,
  currentLeaderId,
  directCount,
  canPlaceAtTop,
}: {
  intent: 'place' | 'move' | 'request';
  personId: string;
  personFirstName: string;
  currentLeaderId: string | null;
  directCount: number;
  canPlaceAtTop: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [mode, setMode] = useState<'with_subtree' | 'leave_group'>('with_subtree');
  const [atTop, setAtTop] = useState(false);
  const [requested, setRequested] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await changeLeaderAction(formData);
      if (!result.ok) {
        setFieldErrors(result.error.fieldErrors ?? {});
        setError(result.error.message);
        return;
      }
      if (result.data.outcome === 'requested') {
        setRequested(true);
        return;
      }
      router.push(`/app/people/${personId}`);
      router.refresh();
    });
  }

  if (requested) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert tone="success" title="Request sent">
          The receiving leader will see it in their leader change requests.
        </Alert>
        <Button asChild variant="secondary">
          <Link href={`/app/people/${personId}`}>Back to {personFirstName}</Link>
        </Button>
      </div>
    );
  }

  const exclude = [personId, ...(currentLeaderId ? [currentLeaderId] : [])];

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="intent" value={intent} />
      {intent === 'move' && <input type="hidden" name="expectedLeaderId" value={currentLeaderId ?? ''} />}
      {error && <Alert tone="error">{error}</Alert>}

      {canPlaceAtTop && intent !== 'request' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={atTop} onChange={(e) => setAtTop(e.target.checked)} className="size-4 accent-brand-deep" />
          Place at the top of the structure (no leader)
        </label>
      )}

      {!atTop && (
        <PersonPicker
          name="leaderId"
          label={intent === 'request' ? 'Requested new leader' : 'New leader'}
          hint={intent === 'request' ? 'Leaders who receive new people are listed.' : 'Only leaders within your scope are listed.'}
          placedOnly
          permission={intent === 'request' ? 'leader_directory' : 'hierarchy.manage'}
          excludeIds={exclude}
          required
          errors={fieldErrors.newLeaderId ?? fieldErrors.leaderId ?? fieldErrors.toLeaderId}
        />
      )}

      {intent === 'move' && directCount > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{personFirstName} leads {directCount} {directCount === 1 ? 'person' : 'people'}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="with_subtree" checked={mode === 'with_subtree'} onChange={() => setMode('with_subtree')} className="mt-0.5 accent-brand-deep" />
            <span>Move with their group <span className="block text-muted">Everyone they lead moves too.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="leave_group" checked={mode === 'leave_group'} onChange={() => setMode('leave_group')} className="mt-0.5 accent-brand-deep" />
            <span>Leave their group with another leader</span>
          </label>
          {mode === 'leave_group' && (
            <PersonPicker
              name="groupNewLeaderId"
              label="Who will lead their group?"
              placedOnly
              permission="hierarchy.manage"
              excludeIds={[personId]}
              required
              errors={fieldErrors.groupNewLeaderId}
            />
          )}
        </fieldset>
      )}

      <div className="space-y-1.5">
        <label htmlFor="reason" className="block text-sm font-medium">
          Reason <span className="font-normal text-muted">(recorded in their history)</span>
        </label>
        <textarea id="reason" name="reason" rows={2} maxLength={500} className={`${inputClassName} h-auto py-2`} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : intent === 'request' ? 'Send request' : intent === 'place' ? 'Place' : 'Move'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/app/people/${personId}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
