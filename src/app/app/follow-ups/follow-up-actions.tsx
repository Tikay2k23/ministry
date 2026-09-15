'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { updateFollowUpAction } from './actions';

type Status = 'open' | 'in_progress' | 'resolved' | 'dismissed';

export function FollowUpActions({ followUpId, status, isMine }: { followUpId: string; status: Status; isMine: boolean }) {
  const router = useRouter();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (next: Status, extra: { assignToMe?: boolean; note?: string } = {}) =>
    startTransition(async () => {
      setError(null);
      const result = await updateFollowUpAction({ followUpId, status: next, ...extra });
      if (result.ok) {
        setResolving(false);
        setNote('');
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });

  if (status === 'resolved' || status === 'dismissed') {
    return (
      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => run('open')} disabled={pending}>
          Reopen
        </Button>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  if (resolving) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={`note-${followUpId}`} className="block text-sm font-medium">
            What happened? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={`note-${followUpId}`}
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Visited on Sunday — doing better"
            className={cn(inputClassName, 'h-auto py-2')}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run('resolved', { note: note.trim() || undefined })} disabled={pending}>
            {pending ? 'Saving…' : 'Save as resolved'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setResolving(false)}>
            Cancel
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!(status === 'in_progress' && isMine) && (
          <Button variant="secondary" size="sm" onClick={() => run('in_progress', { assignToMe: true })} disabled={pending}>
            I’m on it
          </Button>
        )}
        <Button size="sm" onClick={() => setResolving(true)} disabled={pending}>
          Mark resolved
        </Button>
        <Button variant="ghost" size="sm" onClick={() => run('dismissed')} disabled={pending}>
          Not needed
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
