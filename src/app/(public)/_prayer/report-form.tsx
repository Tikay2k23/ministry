'use client';

import { Send, Sprout } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { maxLengthFor, TEXT_FIELD_TYPES } from '@/server/modules/forms/answers';
import type { ReportForm } from '@/server/modules/prayer/participation.service';
import { callApi, publicTextareaClass } from '../_lib/public-api';
import type { PhotoState } from '../_lib/use-photo-upload';
import { ReportPhotoField } from './report-photo-field';
import type { SlotActor } from './slot-card';

const TEXT_TYPES = new Set<string>(TEXT_FIELD_TYPES);

/**
 * The report after a prayer slot (docs/04 P7). The questions, their wording and which of them only
 * the pastoral team may read all come from the form the ministry publishes — nothing here decides
 * what is asked. A photo from the prayer time may come with it, when the chain asks for one.
 */
export function PrayerReportForm({
  actor,
  form,
  formSession,
  onSent,
}: {
  actor: SlotActor;
  form: ReportForm;
  formSession: string;
  onSent: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [anonymous, setAnonymous] = useState(false);
  const [photo, setPhoto] = useState<PhotoState>({ attachmentId: null, uploading: false });
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const filled = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim() !== ''));
      const result = await callApi<{ received: true }>('POST', '/api/public/prayer/report', {
        ...actor,
        answers: filled,
        anonymous,
        formSession,
        ...(photo.attachmentId ? { attachmentId: photo.attachmentId } : {}),
      });
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
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl border border-line bg-surface p-5">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-leaf-tint"
        >
          <Sprout className="size-5 text-brand-deep" />
        </span>
        <div>
          <h2 className="font-display text-xl leading-tight font-extrabold">
            Share a prayer report or testimony
          </h2>
          <p className="text-muted">We’d love to hear how God met you during this time.</p>
        </div>
      </header>

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

      {form.photo !== 'off' && (
        <ReportPhotoField
          actor={actor}
          required={form.photo === 'required'}
          formSession={formSession}
          error={fieldErrors.photo}
          onChange={setPhoto}
        />
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-brand-deep"
        />
        <span>
          Share without my name
          <span className="block text-base text-muted">Only the pastoral team will know it was you.</span>
        </span>
      </label>

      {message && <Alert tone="error">{message}</Alert>}

      <Button type="submit" size="lg" className="w-full" disabled={pending || photo.uploading}>
        <Send aria-hidden className="size-5" />
        {pending ? 'Sending…' : photo.uploading ? 'Waiting for the photo…' : 'Share report'}
      </Button>
    </form>
  );
}
