'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import type { FormFieldType, Sensitivity } from '@/server/db/enums';
import type { FieldDefinition } from '@/server/modules/forms/answers';
import { discardDraftAction, publishDraftAction, saveDraftAction } from './actions';

interface EditableField {
  uid: string;
  key: string;
  type: FormFieldType;
  label: string;
  helpText: string;
  required: boolean;
  sensitivity: Sensitivity;
  options: { key: string; label: string }[];
  maxLength?: number;
}

const TYPE_OPTIONS: { value: FormFieldType; label: string }[] = [
  { value: 'reflection', label: 'Reflection (long answer)' },
  { value: 'long_text', label: 'Long answer' },
  { value: 'short_text', label: 'Short answer' },
  { value: 'scripture_ref', label: 'Bible passage' },
  { value: 'yes_no', label: 'Yes or no' },
  { value: 'single_choice', label: 'Choose one' },
  { value: 'multi_choice', label: 'Choose any' },
  { value: 'gratitude', label: 'Gratitude' },
  { value: 'prayer_request', label: 'Prayer request' },
  { value: 'testimony', label: 'Testimony' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
];

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string }[] = [
  { value: 'standard', label: 'Leaders and pastors' },
  { value: 'restricted', label: 'Direct leader and pastors only' },
  { value: 'confidential', label: 'Pastors only' },
];

const isChoice = (type: FormFieldType) => type === 'single_choice' || type === 'multi_choice';

/** Stable machine key from a label, e.g. "What are you thankful for?" → "what_are_you_thankful_for". */
function toKey(label: string, taken: Set<string>, fallback: string): string {
  let base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  if (!/^[a-z][a-z0-9_]+$/.test(base)) base = fallback;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

export function QuestionsEditor({
  initialFields,
  publishedKeys,
  publishedVersionNo,
  hasDraft,
  canEdit,
  canPublish,
}: {
  initialFields: FieldDefinition[];
  publishedKeys: string[];
  publishedVersionNo: number | null;
  hasDraft: boolean;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const nextUid = useRef(initialFields.length);
  const [fields, setFields] = useState<EditableField[]>(() =>
    initialFields.map((f, i) => ({
      uid: `q${i}`,
      key: f.key,
      type: f.type,
      label: f.label,
      helpText: f.helpText ?? '',
      required: f.required,
      sensitivity: f.sensitivity,
      options: f.config.options ?? [],
      maxLength: f.config.maxLength,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const change = (next: EditableField[]) => {
    setFields(next);
    setDirty(true);
    setNotice(null);
  };
  const update = (uid: string, patch: Partial<EditableField>) => change(fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    change(next);
  };
  const add = () => {
    nextUid.current += 1;
    change([
      ...fields,
      { uid: `q${nextUid.current}`, key: '', type: 'long_text', label: '', helpText: '', required: false, sensitivity: 'standard', options: [] },
    ]);
  };

  const save = () =>
    startTransition(async () => {
      setErrors([]);
      setNotice(null);
      const taken = new Set(fields.map((f) => f.key).filter(Boolean));
      const payload = fields.map((f) => {
        const key = f.key || toKey(f.label, taken, `question_${taken.size + 1}`);
        taken.add(key);
        const optionKeys = new Set<string>();
        const options = isChoice(f.type)
          ? f.options
              .filter((o) => o.label.trim())
              .map((o) => {
                const optionKey = o.key || toKey(o.label, optionKeys, `option_${optionKeys.size + 1}`);
                optionKeys.add(optionKey);
                return { key: optionKey, label: o.label.trim() };
              })
          : undefined;
        return {
          key,
          type: f.type,
          label: f.label.trim(),
          helpText: f.helpText.trim() || null,
          required: f.required,
          sensitivity: f.sensitivity,
          ...(options ? { options } : {}),
          ...(f.maxLength ? { maxLength: f.maxLength } : {}),
        };
      });
      const result = await saveDraftAction(payload);
      if (!result.ok) {
        setErrors([result.error.message, ...Object.values(result.error.fieldErrors ?? {}).flat()]);
        return;
      }
      setFields(fields.map((f, i) => ({ ...f, key: payload[i]!.key, options: payload[i]!.options ?? f.options })));
      setDirty(false);
      setNotice('Draft saved. Publish it when you’re ready for members to see it.');
      router.refresh();
    });

  const publish = () => {
    if (!window.confirm('Publish these questions? The journal page will use them from now on.')) return;
    startTransition(async () => {
      setErrors([]);
      const result = await publishDraftAction();
      if (!result.ok) {
        setErrors([result.error.message]);
        return;
      }
      setNotice('Published. The journal page now shows these questions.');
      router.refresh();
    });
  };

  const discard = () => {
    if (!window.confirm('Discard the draft and go back to the published questions?')) return;
    startTransition(async () => {
      const result = await discardDraftAction();
      if (!result.ok) setErrors([result.error.message]);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {hasDraft ? (
            <Badge tone="amber">Draft — not live yet</Badge>
          ) : publishedVersionNo !== null ? (
            <Badge tone="green">Live · version {publishedVersionNo}</Badge>
          ) : (
            <Badge>No questions published</Badge>
          )}
          {dirty && <Badge tone="slate">Unsaved changes</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? 'Saving…' : 'Save draft'}
            </Button>
          )}
          {canPublish && hasDraft && (
            <Button variant="secondary" onClick={publish} disabled={pending || dirty}>
              Publish
            </Button>
          )}
          {canEdit && hasDraft && (
            <Button variant="ghost" onClick={discard} disabled={pending}>
              Discard draft
            </Button>
          )}
        </div>
      </div>

      {!canEdit && <Alert tone="info">You can publish drafts prepared by the ministry office, but not edit the questions.</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {errors.length > 0 && (
        <Alert tone="error" title="The draft wasn’t saved">
          <ul className="list-disc pl-5">
            {[...new Set(errors)].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <ol className="space-y-4">
        {fields.map((field, index) => (
          <li key={field.uid} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-muted">
                Question {index + 1}
                {publishedKeys.includes(field.key) ? null : <span className="ml-2 font-normal">· new</span>}
              </p>
              {canEdit && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => move(index, -1)} disabled={index === 0}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => move(index, 1)} disabled={index === fields.length - 1}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Remove question" onClick={() => change(fields.filter((f) => f.uid !== field.uid))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${field.uid}-label`} className="block text-sm font-medium">
                Question
              </label>
              <input
                id={`${field.uid}-label`}
                value={field.label}
                maxLength={300}
                disabled={!canEdit}
                onChange={(e) => update(field.uid, { label: e.target.value })}
                className={inputClassName}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${field.uid}-help`} className="block text-sm font-medium">
                Help text <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id={`${field.uid}-help`}
                value={field.helpText}
                maxLength={500}
                disabled={!canEdit}
                onChange={(e) => update(field.uid, { helpText: e.target.value })}
                className={inputClassName}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${field.uid}-type`} className="block text-sm font-medium">
                  Answer type
                </label>
                <select
                  id={`${field.uid}-type`}
                  value={field.type}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const type = e.target.value as FormFieldType;
                    update(field.uid, {
                      type,
                      options:
                        isChoice(type) && field.options.length === 0
                          ? [
                              { key: '', label: '' },
                              { key: '', label: '' },
                            ]
                          : field.options,
                    });
                  }}
                  className={inputClassName}
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${field.uid}-sensitivity`} className="block text-sm font-medium">
                  Who can read the answer
                </label>
                <select
                  id={`${field.uid}-sensitivity`}
                  value={field.sensitivity}
                  disabled={!canEdit}
                  onChange={(e) => update(field.uid, { sensitivity: e.target.value as Sensitivity })}
                  className={inputClassName}
                >
                  {SENSITIVITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isChoice(field.type) && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Options</legend>
                {field.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex gap-2">
                    <label htmlFor={`${field.uid}-opt-${optionIndex}`} className="sr-only">
                      Option {optionIndex + 1}
                    </label>
                    <input
                      id={`${field.uid}-opt-${optionIndex}`}
                      value={option.label}
                      maxLength={120}
                      disabled={!canEdit}
                      onChange={(e) =>
                        update(field.uid, {
                          options: field.options.map((o, i) => (i === optionIndex ? { ...o, label: e.target.value } : o)),
                        })
                      }
                      className={inputClassName}
                    />
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove option ${optionIndex + 1}`}
                        onClick={() => update(field.uid, { options: field.options.filter((_, i) => i !== optionIndex) })}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => update(field.uid, { options: [...field.options, { key: '', label: '' }] })}>
                    <Plus aria-hidden className="size-4" /> Add option
                  </Button>
                )}
              </fieldset>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={field.required}
                disabled={!canEdit}
                onChange={(e) => update(field.uid, { required: e.target.checked })}
                className="size-4 accent-brand-deep"
              />
              Members must answer this question
            </label>
          </li>
        ))}
      </ol>

      {canEdit && (
        <Button variant="secondary" onClick={add} disabled={fields.length >= 40}>
          <Plus aria-hidden className="size-4" /> Add a question
        </Button>
      )}
    </div>
  );
}
