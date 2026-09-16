'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { maxLengthFor, TEXT_FIELD_TYPES } from '@/server/modules/forms/answers';
import type { ReportForm } from '@/server/modules/prayer/participation.service';
import { callApi, publicTextareaClass } from '../_lib/public-api';
import type { SlotActor } from './slot-card';

const TEXT_TYPES = new Set<string>(TEXT_FIELD_TYPES);

/** The optional report after a prayer slot (docs/04 P7): collapsed until the person chooses to share. */
export function PrayerReportForm({ actor, form, formSession, onSent }: { actor: SlotActor; form: ReportForm; formSession: string; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [anonymous, setAnonymous] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <Alert tone="success" title="Thank you for sharing">
        Your report was received.
      </Alert>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-line-strong px-4 py-3 text-left text-base font-medium text-brand-deep"
      >
        Share a prayer report or testimony (optional)
      </button>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const filled = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim() !== ''));
      const result = await callApi<{ received: true }>('POST', '/api/public/prayer/report', { ...actor, answers: filled, anonymous, formSession });
      if (!result.ok) {
        setFieldErrors(result.error.fieldErrors ?? {});
        setMessage(result.error.message);
        return;
      }
      setSent(true);
      onSent();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-xl bg-ground p-4">
      <p className="font-semibold">Share a prayer report or testimony</p>
      {form.fields
        .filter((field) => TEXT_TYPES.has(field.type))
        .map((field) => {
          const id = `report-${field.key}`;
          const errors = fieldErrors[field.key];
          return (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={id} className="block font-medium">
                {field.label}
              </label>
              {field.helpText && (
                <p id={`${id}-hint`} className="text-base text-muted">
                  {field.helpText}
                </p>
              )}
              <textarea
                id={id}
                rows={3}
                maxLength={maxLengthFor(field)}
                value={answers[field.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })}
                aria-describedby={field.helpText ? `${id}-hint` : undefined}
                aria-invalid={errors?.length ? true : undefined}
                className={publicTextareaClass}
              />
              {errors?.length ? (
                <p role="alert" className="text-base text-error">
                  {errors.join(' ')}
                </p>
              ) : null}
            </div>
          );
        })}
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="mt-1 size-5 shrink-0 accent-brand-deep" />
        <span>
          Share without my name
          <span className="block text-base text-muted">Only the pastoral team will know it was you.</span>
        </span>
      </label>
      {message && <Alert tone="error">{message}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Share'}
      </Button>
    </form>
  );
}
