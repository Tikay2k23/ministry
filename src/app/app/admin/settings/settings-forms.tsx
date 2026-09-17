'use client';

import { ArrowDown, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, inputClassName } from '@/components/ui/field';
import { SETTINGS, type SettingValue } from '@/server/modules/settings/definitions';
import { saveLeadershipLevelsAction, updateSettingAction } from '../actions';

/** Settings forms (docs/04 A26): each card saves one setting, with what the choice means for people. */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function Toggle<T extends FieldValues>({ control, name, label, hint, disabled }: { control: Control<T>; name: Path<T>; label: string; hint?: string; disabled: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start gap-3">
          <Checkbox checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} disabled={disabled} className="mt-0.5" />
          <span>
            <span className="block text-sm font-medium">{label}</span>
            {hint && <span className="block text-sm text-muted">{hint}</span>}
          </span>
        </label>
      )}
    />
  );
}

function SelectField({ id, label, hint, children, ...props }: { id: string; label: string; hint?: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select id={id} className={inputClassName} {...props}>
        {children}
      </select>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

function SaveRow({ canEdit, pending, saved, formError, lockedNote }: { canEdit: boolean; pending: boolean; saved: boolean; formError: string | null; lockedNote?: string }) {
  if (!canEdit) return <p className="text-sm text-muted">{lockedNote ?? 'Only administrators with two-step verification can change this.'}</p>;
  return (
    <div className="space-y-3">
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Saved. It applies right away.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ─── General ──────────────────────────────────────────────────────────────────

export function GeneralForm({ value, timeZones, canEdit }: { value: SettingValue<'ministry.profile'>; timeZones: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: SETTINGS['ministry.profile'].schema,
    defaultValues: value,
    action: (values) => updateSettingAction('ministry.profile', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <Field label="Ministry name" {...form.register('name')} defaultValue={String(form.formState.defaultValues?.name ?? '')} errors={errorsFor('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short name" hint="Used in page titles and emails." {...form.register('shortName')} defaultValue={String(form.formState.defaultValues?.shortName ?? '')} errors={errorsFor('shortName')} />
          <Field label="Tagline" {...form.register('tagline')} defaultValue={String(form.formState.defaultValues?.tagline ?? '')} errors={errorsFor('tagline')} />
        </div>
        <SelectField id="settings-timezone" label="Time zone" hint="Journal days, deadlines and gathering times follow this. Change it only before people start journaling." {...form.register('timezone')} defaultValue={String(form.formState.defaultValues?.timezone ?? '')}>
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country code" hint="For mobile numbers, e.g. PH." maxLength={2} {...form.register('defaultCountry')} defaultValue={String(form.formState.defaultValues?.defaultCountry ?? '')} errors={errorsFor('defaultCountry')} />
          <Field label="Language and region" hint="For dates and numbers, e.g. en-PH." {...form.register('locale')} defaultValue={String(form.formState.defaultValues?.locale ?? '')} errors={errorsFor('locale')} />
        </div>
      </fieldset>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} />
    </form>
  );
}

// ─── People fields ────────────────────────────────────────────────────────────

export function PeopleFieldsForm({ value, canEdit }: { value: SettingValue<'people.fields'>; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError } = useActionForm({
    schema: SETTINGS['people.fields'].schema,
    defaultValues: value,
    action: (values) => updateSettingAction('people.fields', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onClick={() => setSaved(false)} noValidate className="space-y-4">
      <div className="space-y-3">
        <Toggle control={form.control} name="collectGender" label="Gender" hint="Asked when someone is added." disabled={!canEdit} />
        <Toggle control={form.control} name="collectAddress" label="Address" hint="Street, city and province on the profile." disabled={!canEdit} />
        <Toggle control={form.control} name="collectBirthYear" label="Year of birth" hint="Otherwise birthdays keep only the day and month." disabled={!canEdit} />
        <Toggle control={form.control} name="ministryRequiredAtRegistration" label="Ministry when registering" hint="New people choose a ministry on the journal page." disabled={!canEdit} />
      </div>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} />
    </form>
  );
}

// ─── Leadership ───────────────────────────────────────────────────────────────

const HierarchyFormSchema = z.object({
  primaryLeaderDepth: z.coerce.number().int().min(0, 'At least 0').max(10, 'At most 10'),
  groupSizeSoftLimit: z.coerce.number().int().min(1, 'At least 1').max(200, 'At most 200'),
  leaderStatusDepth: z.string().transform((v) => (v === '' ? null : Number(v))),
});

export function HierarchyForm({ value, canEdit }: { value: SettingValue<'hierarchy'>; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: HierarchyFormSchema,
    defaultValues: { ...value, leaderStatusDepth: value.leaderStatusDepth === null ? '' : String(value.leaderStatusDepth) },
    action: (values) => updateSettingAction('hierarchy', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Level of Primary Leaders"
            type="number"
            min={0}
            max={10}
            hint="0 when they are the top of the tree."
            {...form.register('primaryLeaderDepth')} defaultValue={String(form.formState.defaultValues?.primaryLeaderDepth ?? '')}
            errors={errorsFor('primaryLeaderDepth')}
          />
          <Field
            label="Group size to watch"
            type="number"
            min={1}
            max={200}
            hint="Leaders get a gentle note above this size."
            {...form.register('groupSizeSoftLimit')} defaultValue={String(form.formState.defaultValues?.groupSizeSoftLimit ?? '')}
            errors={errorsFor('groupSizeSoftLimit')}
          />
        </div>
        <SelectField id="settings-status-depth" label="Leaders see journal status for" hint="For leaders invited from now on. Journal answers follow the journal policy." {...form.register('leaderStatusDepth')} defaultValue={String(form.formState.defaultValues?.leaderStatusDepth ?? '')}>
          <option value="1">Their own group</option>
          <option value="2">Their group and one level below</option>
          <option value="3">Three levels</option>
          {value.leaderStatusDepth !== null && value.leaderStatusDepth > 3 && <option value={value.leaderStatusDepth}>{value.leaderStatusDepth} levels</option>}
          <option value="">Everyone below them</option>
        </SelectField>
      </fieldset>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} />
    </form>
  );
}

interface LevelRow {
  name: string;
  pluralName: string;
  description: string;
}

export function LeadershipLevelsEditor({ levels, canEdit }: { levels: { depth: number; name: string; pluralName: string; description: string | null }[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<LevelRow[]>(levels.map((l) => ({ name: l.name, pluralName: l.pluralName, description: l.description ?? '' })));
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const update = (index: number, patch: Partial<LevelRow>) => {
    setMessage(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const save = () =>
    startTransition(async () => {
      const result = await saveLeadershipLevelsAction({ levels: rows });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error.fieldErrors ? 'Each level needs a name and a plural.' : result.error.message });
        return;
      }
      setMessage({ tone: 'success', text: 'Saved.' });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="space-y-2 rounded-lg border border-line p-3">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
              {index === 0 ? 'Top of the tree' : (
                <>
                  <ArrowDown aria-hidden className="size-3" /> Level {index}
                </>
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label={`Level ${index}: name`} value={row.name} disabled={!canEdit} onChange={(e) => update(index, { name: e.target.value })} className={inputClassName} />
              <input aria-label={`Level ${index}: plural`} value={row.pluralName} disabled={!canEdit} onChange={(e) => update(index, { pluralName: e.target.value })} className={inputClassName} />
            </div>
          </li>
        ))}
      </ol>
      {canEdit ? (
        <>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((current) => [...current, { name: '', pluralName: '', description: '' }])} disabled={rows.length >= 12}>
                <Plus aria-hidden className="size-4" /> Add a level
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows((current) => current.slice(0, -1))} disabled={rows.length <= 1}>
                <X aria-hidden className="size-4" /> Remove the last level
              </Button>
            </div>
            <Button variant="secondary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save level names'}
            </Button>
          </div>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
        </>
      ) : (
        <p className="text-sm text-muted">Only administrators with two-step verification can change these names.</p>
      )}
    </div>
  );
}

// ─── Journal policy ───────────────────────────────────────────────────────────

const JournalPolicyFormSchema = z.object({
  deadlineTime: z.string().regex(TIME, 'Choose a time'),
  lateCutoffTime: z.string().regex(TIME, 'Choose a time').refine((v) => v < '12:00', 'Late journals must close before noon'),
  editWindow: z.enum(['until_deadline', 'none']),
  contentVisibilityDepth: z.coerce.number().int().min(1).max(10),
  missedStreakThreshold: z.coerce.number().int().min(2, 'At least 2 days').max(30, 'At most 30 days'),
  reviewExpected: z.boolean(),
  showStreaksToLeaders: z.boolean(),
});

export function JournalPolicyForm({ value, canEdit }: { value: SettingValue<'journal.policy'>; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: JournalPolicyFormSchema,
    defaultValues: value,
    action: (values) => updateSettingAction('journal.policy', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="On time until" type="time" hint="Journals sent by then are on time." {...form.register('deadlineTime')} defaultValue={String(form.formState.defaultValues?.deadlineTime ?? '')} errors={errorsFor('deadlineTime')} />
          <Field label="Late journals until (next morning)" type="time" hint="After this, yesterday closes." {...form.register('lateCutoffTime')} defaultValue={String(form.formState.defaultValues?.lateCutoffTime ?? '')} errors={errorsFor('lateCutoffTime')} />
        </div>
        <SelectField id="settings-edit-window" label="Editing a sent journal" {...form.register('editWindow')} defaultValue={String(form.formState.defaultValues?.editWindow ?? '')}>
          <option value="until_deadline">Allowed from the same phone until the deadline</option>
          <option value="none">Not allowed</option>
        </SelectField>
        <SelectField
          id="settings-visibility"
          label="Who can read a person’s journal answers"
          hint="Pastors and pastoral care always can. Letting more leaders read needs two-step verification. Confidential answers stay with pastors."
          {...form.register('contentVisibilityDepth')} defaultValue={String(form.formState.defaultValues?.contentVisibilityDepth ?? '')}
        >
          <option value="1">Only their direct leader</option>
          <option value="2">Their leader and the leader above</option>
          <option value="3">Three levels of leaders</option>
          {![1, 2, 3, 10].includes(value.contentVisibilityDepth) && <option value={value.contentVisibilityDepth}>{value.contentVisibilityDepth} levels of leaders</option>}
          <option value="10">Every leader above them</option>
        </SelectField>
        <Field
          label="Days missed before a follow-up is suggested"
          type="number"
          min={2}
          max={30}
          {...form.register('missedStreakThreshold')} defaultValue={String(form.formState.defaultValues?.missedStreakThreshold ?? '')}
          errors={errorsFor('missedStreakThreshold')}
        />
        <div className="space-y-3">
          <Toggle control={form.control} name="reviewExpected" label="Leaders review their people’s journals" hint="Unreviewed journals show in the leader’s review list." disabled={!canEdit} />
          <Toggle control={form.control} name="showStreaksToLeaders" label="Show streaks to leaders" hint="How many days in a row someone has journaled." disabled={!canEdit} />
        </div>
      </fieldset>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} lockedNote="Pastors and administrators can change the journal policy." />
    </form>
  );
}

// ─── Public forms ─────────────────────────────────────────────────────────────

export function PublicFormsForm({ value, canEdit }: { value: SettingValue<'public.identification'>; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError } = useActionForm({
    schema: SETTINGS['public.identification'].schema,
    defaultValues: value,
    action: (values) => updateSettingAction('public.identification', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <Toggle
        control={form.control}
        name="phoneMatchEnabled"
        label="Find people by mobile number and first name"
        hint="On a new phone, people can find themselves this way instead of registering again."
        disabled={!canEdit}
      />
      <fieldset disabled={!canEdit}>
        <SelectField id="settings-challenge" label="Bot check on registration" hint="The bot check isn’t connected yet, so this has no effect until it is." {...form.register('challengeMode')} defaultValue={String(form.formState.defaultValues?.challengeMode ?? '')}>
          <option value="off">Off</option>
          <option value="risk_based">Only when something looks automated</option>
          <option value="always">Always</option>
        </SelectField>
      </fieldset>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} />
    </form>
  );
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

const PrivacyFormSchema = z.object({
  noticeVersion: z.string().min(1),
  minorsParticipate: z.boolean(),
  adultAge: z.coerce.number().int().min(13, 'At least 13').max(21, 'At most 21'),
});

export function PrivacyForm({ value, canEdit }: { value: SettingValue<'privacy'>; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: PrivacyFormSchema,
    defaultValues: value,
    action: (values) => updateSettingAction('privacy', values),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <p className="text-sm">
        Privacy notice in use: <strong>{value.noticeVersion}</strong>
        {value.noticeVersion.endsWith('draft') && <span className="text-warn"> (still a draft: have your Data Protection Officer review it before the pilot)</span>}
      </p>
      <Toggle control={form.control} name="minorsParticipate" label="Young people take part" hint="Under the adult age, a parent or guardian agrees when they register." disabled={!canEdit} />
      <fieldset disabled={!canEdit}>
        <Field label="Adult age" type="number" min={13} max={21} {...form.register('adultAge')} defaultValue={String(form.formState.defaultValues?.adultAge ?? '')} errors={errorsFor('adultAge')} />
      </fieldset>
      <SaveRow canEdit={canEdit} pending={pending} saved={saved} formError={formError} />
    </form>
  );
}
