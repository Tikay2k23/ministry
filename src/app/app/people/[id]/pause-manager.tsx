'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { addPauseAction, endPauseAction } from './journal-actions';

const REASONS = [
  { value: 'leave', label: 'Leave' },
  { value: 'sickness', label: 'Sickness' },
  { value: 'travel', label: 'Travel' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'other', label: 'Other' },
];
const reasonLabel = (value: string) => REASONS.find((r) => r.value === value)?.label ?? value;

interface Pause {
  id: string;
  startsOn: string;
  endsOn: string | null;
  reason: string;
  note: string | null;
}

export function PauseManager({ personId, today, pauses }: { personId: string; today: string; pauses: Pause[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const current = pauses.filter((p) => p.endsOn === null || p.endsOn >= today);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    setError(null);
    startTransition(async () => {
      const result = await addPauseAction({
        personId,
        startsOn: text('startsOn'),
        endsOn: text('endsOn') || undefined,
        reason: text('reason'),
        note: text('note') || undefined,
      });
      if (result.ok) {
        setAdding(false);
        setFieldErrors({});
        router.refresh();
      } else {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
      }
    });
  }

  const end = (pauseId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await endPauseAction(personId, pauseId);
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <div className="space-y-3 text-sm">
      {current.length === 0 ? (
        <p className="text-muted">No pause in place. A pause excuses every day in its range — for leave, sickness or travel.</p>
      ) : (
        <ul className="space-y-2">
          {current.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <div>
                <p className="font-medium">
                  {formatDayLabel(p.startsOn, 'short')} – {p.endsOn ? formatDayLabel(p.endsOn, 'short') : 'until further notice'}
                </p>
                <p className="text-muted">
                  {reasonLabel(p.reason)}
                  {p.note ? ` · ${p.note}` : ''}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => end(p.id)} disabled={pending}>
                {p.startsOn > today ? 'Cancel' : 'End today'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`pause-start-${personId}`} className="block font-medium">
                From
              </label>
              <input id={`pause-start-${personId}`} name="startsOn" type="date" defaultValue={today} required className={inputClassName} />
              {fieldErrors.startsOn && <p className="text-error">{fieldErrors.startsOn.join(' ')}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`pause-end-${personId}`} className="block font-medium">
                Until <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id={`pause-end-${personId}`} name="endsOn" type="date" min={today} className={inputClassName} />
              {fieldErrors.endsOn && <p className="text-error">{fieldErrors.endsOn.join(' ')}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`pause-reason-${personId}`} className="block font-medium">
              Reason
            </label>
            <select id={`pause-reason-${personId}`} name="reason" defaultValue="leave" className={inputClassName}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`pause-note-${personId}`} className="block font-medium">
              Note <span className="font-normal text-muted">(optional, seen by leaders who manage pauses)</span>
            </label>
            <input id={`pause-note-${personId}`} name="note" maxLength={300} className={inputClassName} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Add pause'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Add a pause
        </Button>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
