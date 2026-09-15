'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { decideRequestAction } from './actions';

export function DecideButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: 'approve' | 'reject') {
    setError(null);
    startTransition(async () => {
      const result = await decideRequestAction(requestId, decision, note);
      if (!result.ok) setError(result.error.message);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-72">
      <label className="sr-only" htmlFor={`note-${requestId}`}>
        Note (optional)
      </label>
      <input
        id={`note-${requestId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note (optional)"
        className={`${inputClassName} h-9`}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => decide('approve')} disabled={pending}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide('reject')} disabled={pending}>
          Decline
        </Button>
      </div>
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
