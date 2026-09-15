'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { addMembershipAction } from './actions';

interface Ministry {
  id: string;
  name: string;
  departments: { id: string; name: string }[];
}

export function MinistryMembershipForm({ personId, ministries }: { personId: string; ministries: Ministry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ministryId, setMinistryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const departments = ministries.find((m) => m.id === ministryId)?.departments ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await addMembershipAction(formData);
      if (result.ok) {
        setOpen(false);
        setMinistryId('');
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add to a ministry
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="hidden" name="personId" value={personId} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1.5">
        <label htmlFor="ministryId" className="block text-sm font-medium">
          Ministry
        </label>
        <select id="ministryId" name="ministryId" value={ministryId} onChange={(e) => setMinistryId(e.target.value)} className={inputClassName} required>
          <option value="">Choose…</option>
          {ministries.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {departments.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="departmentId" className="block text-sm font-medium">
            Department <span className="font-normal text-muted">(optional)</span>
          </label>
          <select id="departmentId" name="departmentId" className={inputClassName}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="position" className="block text-sm font-medium">
          Position
        </label>
        <select id="position" name="position" className={inputClassName} defaultValue="member">
          <option value="member">Member</option>
          <option value="worker">Worker</option>
          <option value="assistant_head">Assistant head</option>
          <option value="head">Head</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrimary" className="size-4 accent-brand-deep" /> Primary ministry
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
