'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { FieldDefinition } from '@/server/modules/forms/answers';
import { submitProxyJournalAction } from '../../journal-actions';

type Value = string | boolean | string[];

const LONG_TEXT_TYPES = new Set(['long_text', 'reflection', 'prayer_request', 'testimony', 'gratitude']);

export function ProxyJournalForm({
  personId,
  versionId,
  fields,
  dates,
}: {
  personId: string;
  versionId: string;
  fields: FieldDefinition[];
  dates: { date: string; label: string; received: boolean }[];
}) {
  const router = useRouter();
  const [journalDate, setJournalDate] = useState(dates.find((d) => !d.received)?.date ?? '');
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const key = idempotencyKey.current;
    const picked = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v !== '' && !(Array.isArray(v) && v.length === 0)),
    );
    startTransition(async () => {
      const result = await submitProxyJournalAction({ personId, journalDate, formVersionId: versionId, idempotencyKey: key, answers: picked });
      if (result.ok) {
        router.push(`/app/journal/${personId}/${result.data.journalDate}`);
        return;
      }
      setFieldErrors(result.error.fieldErrors ?? {});
      setError(result.error.message);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="proxy-date" className="block text-sm font-medium">
          Which day is this journal for?
        </label>
        <select id="proxy-date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} className={inputClassName} required>
          {dates.map((d) => (
            <option key={d.date} value={d.date} disabled={d.received}>
              {d.label}
              {d.received ? ' — already received' : ''}
            </option>
          ))}
        </select>
        {fieldErrors.journalDate && <p className="text-sm text-error">{fieldErrors.journalDate.join(' ')}</p>}
      </div>

      {fields.map((field) => (
        <PortalField
          key={field.key}
          field={field}
          value={answers[field.key]}
          errors={fieldErrors[field.key]}
          onChange={(value) => setAnswers((prev) => ({ ...prev, [field.key]: value }))}
        />
      ))}

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" disabled={pending || !journalDate}>
        {pending ? 'Saving…' : 'Save journal'}
      </Button>
    </form>
  );
}

function PortalField({
  field,
  value,
  errors,
  onChange,
}: {
  field: FieldDefinition;
  value: Value | undefined;
  errors?: string[];
  onChange: (value: Value) => void;
}) {
  const id = `proxy-${field.key}`;
  const invalid = Boolean(errors?.length);
  const title = (
    <>
      {field.label}
      {!field.required && <span className="font-normal text-muted"> (optional)</span>}
      {field.sensitivity !== 'standard' && (
        <span className="ml-2 text-xs font-normal text-muted">{field.sensitivity === 'restricted' ? 'Leader & pastors' : 'Pastors only'}</span>
      )}
    </>
  );
  const errorText = invalid ? (
    <p role="alert" className="text-sm text-error">
      {errors!.join(' ')}
    </p>
  ) : null;

  if (field.type === 'yes_no' || field.type === 'single_choice' || field.type === 'multi_choice') {
    const options =
      field.type === 'yes_no'
        ? [
            { key: 'yes', label: 'Yes' },
            { key: 'no', label: 'No' },
          ]
        : (field.config.options ?? []);
    const multi = field.type === 'multi_choice';
    const checked = (key: string) =>
      field.type === 'yes_no' ? value === (key === 'yes') : multi ? Array.isArray(value) && value.includes(key) : value === key;
    const choose = (key: string) => {
      if (field.type === 'yes_no') onChange(key === 'yes');
      else if (multi) {
        const list = Array.isArray(value) ? value : [];
        onChange(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
      } else onChange(key);
    };
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{title}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {options.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm">
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={id}
                checked={checked(option.key)}
                onChange={() => choose(option.key)}
                className="size-4 accent-brand-deep"
              />
              {option.label}
            </label>
          ))}
        </div>
        {errorText}
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {title}
      </label>
      {LONG_TEXT_TYPES.has(field.type) ? (
        <textarea
          id={id}
          rows={3}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          className={cn(inputClassName, 'h-auto py-2')}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={text}
          placeholder={field.type === 'scripture_ref' ? 'e.g. John 3:16' : undefined}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          className={inputClassName}
        />
      )}
      {errorText}
    </div>
  );
}
