'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { decideRegistrationAction } from './actions';

export function DecideRegistration({ personId, name }: { personId: string; name: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: 'confirm' | 'decline') {
    setError(null);
    startTransition(async () => {
      const result = await decideRegistrationAction(personId, decision, note);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-72">
      <label className="sr-only" htmlFor={`note-${personId}`}>
        Note (optional)
      </label>
      <input
        id={`note-${personId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        placeholder="Note (optional)"
        className={cn(inputClassName, 'h-9')}
      />
      {confirmingDecline ? (
        <div className="space-y-2 rounded-lg border border-error/30 bg-error-tint p-3 text-sm">
          <p>Decline {name}? They’ll be removed from the leadership structure and archived.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => decide('decline')} disabled={pending}>
              Yes, decline
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDecline(false)} disabled={pending}>
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide('confirm')} disabled={pending}>
            {pending ? 'Saving…' : 'Confirm'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirmingDecline(true)} disabled={pending}>
            Decline…
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
