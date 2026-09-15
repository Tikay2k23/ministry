'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { archivePersonAction } from '../actions';

const REASONS = [
  { value: 'left', label: 'Has left the ministry' },
  { value: 'moved', label: 'Moved to another church or city' },
  { value: 'deceased', label: 'Has passed away' },
  { value: 'other', label: 'Other reason' },
];

export function ArchiveForm({ personId }: { personId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await archivePersonAction(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/app/people/${personId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <input type="hidden" name="personId" value={personId} />
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Reason</legend>
        {REASONS.map((r, i) => (
          <label key={r.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="reason" value={r.value} defaultChecked={i === 0} className="accent-brand-deep" />
            {r.label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor="note" className="block text-sm font-medium">
          Note <span className="font-normal text-muted">(optional, kept in the audit log)</span>
        </label>
        <textarea id="note" name="note" rows={2} maxLength={500} className={`${inputClassName} h-auto py-2`} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? 'Archiving…' : 'Archive'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/app/people/${personId}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
