'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { deactivateUserAction } from './actions';

export function DeactivateButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    startTransition(async () => {
      const result = await deactivateUserAction(userId, reason);
      if (!result.ok) setError(result.error.fieldErrors?.reason?.join(' ') ?? result.error.message);
    });
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Deactivate
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-2">
      <label className="sr-only" htmlFor={`reason-${userId}`}>
        Reason for deactivating {name}
      </label>
      <input id={`reason-${userId}`} name="reason" required placeholder="Reason" className={`${inputClassName} h-9 w-48`} />
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? 'Deactivating…' : 'Deactivate'}
        </Button>
      </div>
    </form>
  );
}
