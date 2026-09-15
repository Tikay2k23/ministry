'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { PersonPicker } from '@/components/portal/person-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, inputClassName } from '@/components/ui/field';
import type { Result } from '@/server/errors';
import { createPersonAction, updatePersonAction } from './actions';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface PersonFormValues {
  firstName: string;
  lastName: string;
  middleName: string | null;
  suffix: string | null;
  preferredName: string | null;
  gender: string | null;
  joinedOn: string | null;
  status?: string;
  journalExpected: boolean;
  designations: string[];
  contact: {
    phone: string;
    email: string;
    birthMonth: number | null;
    birthDay: number | null;
    birthYear: number | null;
    addressLine: string;
    city: string;
    province: string;
  } | null;
}

interface DuplicateMeta {
  candidates: { personId: string; personCode: string; name: string; reasons: string[] }[];
  hiddenCount: number;
}

const REASON_LABEL: Record<string, string> = { same_phone: 'same mobile', same_email: 'same email', similar_name: 'similar name' };

export function PersonForm({
  mode,
  personId,
  expectedUpdatedAt,
  initial,
  designationOptions,
  fields,
  canEditContact,
  leader,
}: {
  mode: 'create' | 'edit';
  personId?: string;
  expectedUpdatedAt?: string;
  initial: PersonFormValues;
  designationOptions: { key: string; name: string }[];
  fields: { collectGender: boolean; collectAddress: boolean; collectBirthYear: boolean };
  canEditContact: boolean;
  leader?: { defaultValue: { id: string; name: string } | null; required: boolean };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [duplicates, setDuplicates] = useState<DuplicateMeta | null>(null);
  const contact = initial.contact;
  const contactDisabled = mode === 'edit' && !canEditContact;

  function handle(result: Result<{ personId: string }>) {
    if (result.ok) {
      router.push(`/app/people/${result.data.personId}`);
      router.refresh();
      return;
    }
    if (result.error.meta?.reason === 'DUPLICATE_SUSPECTED') {
      setDuplicates(result.error.meta as unknown as DuplicateMeta);
      return;
    }
    setFieldErrors(result.error.fieldErrors ?? {});
    setError(result.error.fieldErrors ? 'Please check the highlighted fields.' : result.error.message);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function send(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handle(mode === 'create' ? await createPersonAction(formData) : await updatePersonAction(formData));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDuplicates(null);
    send(new FormData(event.currentTarget));
  }

  function confirmDifferentPerson() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('confirmNotDuplicate', 'true');
    setDuplicates(null);
    send(formData);
  }

  const e = (key: string) => fieldErrors[key];

  return (
    <form ref={formRef} onSubmit={onSubmit} className="max-w-3xl space-y-6" noValidate>
      {personId && <input type="hidden" name="personId" value={personId} />}
      {expectedUpdatedAt && <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />}
      <input type="hidden" name="journalExpectedPresent" value="1" />
      <input type="hidden" name="designationsPresent" value="1" />

      {error && <Alert tone="error">{error}</Alert>}
      {duplicates && (
        <Alert tone="warning" title="This person may already be in the directory">
          {duplicates.candidates.length > 0 && (
            <ul className="my-2 list-disc space-y-1 pl-5">
              {duplicates.candidates.map((c) => (
                <li key={c.personId}>
                  <Link href={`/app/people/${c.personId}`} className="font-semibold underline" target="_blank">
                    {c.name}
                  </Link>{' '}
                  ({c.personCode}) — {c.reasons.map((r) => REASON_LABEL[r] ?? r).join(', ')}
                </li>
              ))}
            </ul>
          )}
          {duplicates.hiddenCount > 0 && (
            <p className="my-2">
              {duplicates.hiddenCount === 1 ? 'Someone' : `${duplicates.hiddenCount} people`} outside your group already
              {duplicates.hiddenCount === 1 ? ' uses' : ' use'} these details. If unsure, ask the ministry office before adding.
            </p>
          )}
          <Button size="sm" variant="secondary" onClick={confirmDifferentPerson} disabled={pending}>
            This is a different person — add anyway
          </Button>
        </Alert>
      )}

      <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <legend className="px-1 font-display font-bold">Name</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" defaultValue={initial.firstName} required autoComplete="off" errors={e('firstName')} />
          <Field label="Last name" name="lastName" defaultValue={initial.lastName} required autoComplete="off" errors={e('lastName')} />
          <Field label="Middle name" name="middleName" defaultValue={initial.middleName ?? ''} autoComplete="off" errors={e('middleName')} />
          <Field label="Preferred name" name="preferredName" defaultValue={initial.preferredName ?? ''} hint="What people call them, e.g. Jun" errors={e('preferredName')} />
          <Field label="Suffix" name="suffix" defaultValue={initial.suffix ?? ''} hint="Jr., III" errors={e('suffix')} />
          {fields.collectGender && (
            <div className="space-y-1.5">
              <label htmlFor="gender" className="block text-sm font-medium">
                Gender
              </label>
              <select id="gender" name="gender" defaultValue={initial.gender ?? ''} className={inputClassName}>
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          )}
        </div>
      </fieldset>

      {(mode === 'create' || contact) && (
        <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5" disabled={contactDisabled}>
          <legend className="px-1 font-display font-bold">Contact</legend>
          {contactDisabled && <p className="text-sm text-muted">You can see but not change contact details for this person.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number" name="phone" type="tel" inputMode="tel" defaultValue={contact?.phone ?? ''} hint="e.g. 0917 123 4567" errors={e('phone')} />
            <Field label="Email" name="email" type="email" defaultValue={contact?.email ?? ''} errors={e('email')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="birthMonth" className="block text-sm font-medium">
                Birthday month
              </label>
              <select id="birthMonth" name="birthMonth" defaultValue={contact?.birthMonth ?? ''} className={inputClassName}>
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              {e('birthMonth') && <p className="text-sm text-error">{e('birthMonth')!.join(' ')}</p>}
            </div>
            <Field label="Day" name="birthDay" inputMode="numeric" defaultValue={contact?.birthDay ?? ''} errors={e('birthDay')} />
            {fields.collectBirthYear && (
              <Field label="Year" name="birthYear" inputMode="numeric" defaultValue={contact?.birthYear ?? ''} errors={e('birthYear')} />
            )}
          </div>
          {fields.collectAddress && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Address" name="addressLine" defaultValue={contact?.addressLine ?? ''} />
              <Field label="City" name="city" defaultValue={contact?.city ?? ''} />
              <Field label="Province" name="province" defaultValue={contact?.province ?? ''} />
            </div>
          )}
        </fieldset>
      )}

      {mode === 'create' && leader && (
        <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <legend className="px-1 font-display font-bold">Leadership</legend>
          <PersonPicker
            name="leaderId"
            label={leader.required ? 'Leader' : 'Leader (optional)'}
            hint="The person who disciples them. You can change this later."
            placedOnly
            permission="people.create"
            defaultValue={leader.defaultValue}
            required={leader.required}
            errors={e('leaderId')}
          />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acceptsMembers" className="mt-0.5 size-4 accent-brand-deep" />
            <span>
              Show them in the leader selector
              <span className="block text-muted">For leaders who receive new people into their group.</span>
            </span>
          </label>
        </fieldset>
      )}

      <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <legend className="px-1 font-display font-bold">Ministry life</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date joined" name="joinedOn" type="date" defaultValue={initial.joinedOn ?? ''} errors={e('joinedOn')} />
          {mode === 'edit' && (
            <div className="space-y-1.5">
              <label htmlFor="status" className="block text-sm font-medium">
                Status
              </label>
              <select id="status" name="status" defaultValue={initial.status} className={inputClassName}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Designations</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {designationOptions.map((d) => (
              <label key={d.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="designations" value={d.key} defaultChecked={initial.designations.includes(d.key)} className="size-4 accent-brand-deep" />
                {d.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="journalExpected" defaultChecked={initial.journalExpected} className="mt-0.5 size-4 accent-brand-deep" />
          <span>
            Expected to send a daily journal
            <span className="block text-muted">Leaders see them in their daily journal view.</span>
          </span>
        </label>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Add person' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href={personId ? `/app/people/${personId}` : '/app/people'}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
