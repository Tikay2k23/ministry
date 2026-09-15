'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { removeCalendarDayAction, setCalendarDayAction } from './actions';

export function CalendarDayForm({ today }: { today: string }) {
  const router = useRouter();
  const [excusesJournal, setExcusesJournal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await setCalendarDayAction({
        day: String(data.get('day') ?? ''),
        kind: String(data.get('kind') ?? 'journal_rest_day'),
        excusesJournal,
        note: String(data.get('note') ?? '').trim() || undefined,
      });
      if (result.ok) {
        form.reset();
        setExcusesJournal(true);
        setFieldErrors({});
        router.refresh();
      } else {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]">
      <div className="space-y-1">
        <label htmlFor="day" className="text-sm font-medium">
          Date
        </label>
        <input id="day" name="day" type="date" min={today} required className={inputClassName} />
        {fieldErrors.day && <p className="text-sm text-error">{fieldErrors.day.join(' ')}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="kind" className="text-sm font-medium">
          Kind
        </label>
        <select id="kind" name="kind" defaultValue="journal_rest_day" className={inputClassName}>
          <option value="journal_rest_day">Journal rest day</option>
          <option value="holiday">Holiday</option>
          <option value="special">Special day</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="note" className="text-sm font-medium">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="note" name="note" maxLength={200} placeholder="e.g. Church anniversary" className={inputClassName} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add day'}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
        <input type="checkbox" checked={excusesJournal} onChange={(e) => setExcusesJournal(e.target.checked)} className="size-4 accent-brand-deep" />
        No one is expected to journal on this day
      </label>
      {error && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </form>
  );
}

export function RemoveDayButton({ day }: { day: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await removeCalendarDayAction(day);
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-error">
          {error}
        </span>
      )}
    </span>
  );
}
