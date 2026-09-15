'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { excuseDayAction } from '../../actions';

export function ExcuseDay({ personId, date, excused }: { personId: string; date: string; excused: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (value: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await excuseDayAction({ personId, journalDate: date, excused: value, note: note.trim() || undefined });
      if (result.ok) {
        setOpen(false);
        setNote('');
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });

  if (excused) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" size="sm" onClick={() => run(false)} disabled={pending}>
          {pending ? 'Saving…' : 'Undo excuse'}
        </Button>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Excuse this day
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 sm:w-72">
      <div className="space-y-1.5">
        <label htmlFor="excuse-note" className="block text-sm font-medium">
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="excuse-note"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Hospital duty"
          className={inputClassName}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => run(true)} disabled={pending}>
          {pending ? 'Saving…' : 'Excuse day'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
