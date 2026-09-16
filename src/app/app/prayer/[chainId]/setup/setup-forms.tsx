'use client';

import { Copy, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { PersonPicker } from '@/components/portal/person-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import type { PrayerChainStatus, PrayerChainType } from '@/server/db/enums';
import type { Result } from '@/server/errors';
import type { PlacementFailure } from '@/server/modules/prayer/placement';
import { chainShape, checkChainDates, checkScheduleValues, scheduleShape, timeOfDay } from '@/server/modules/prayer/prayer.schemas';
import {
  addScheduleAction,
  appointCoordinatorAction,
  createCommitmentAction,
  endCommitmentAction,
  endScheduleAction,
  removeCoordinatorAction,
  setChainStatusAction,
  updateChainAction,
} from '../../actions';
import { ChainBasicsFields, ChainChoicesFields, checkWeekdays, ErrorText, RepeatFields, repeatShape, ruleFor, SlotPatternFields } from '../../chain-fields';
import { PeopleSearch, type PersonOption } from '../../people-search';

/** The actions and forms on a chain's schedule & setup page (docs/04 A18). */

// ─── A button that asks first ─────────────────────────────────────────────────

function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  run,
  destructive = false,
  children,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<Result<unknown>>;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const result = await run();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={destructive ? 'ghost' : 'secondary'} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {error && <Alert tone="error">{error}</Alert>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : undefined} onClick={confirm} disabled={pending}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status ───────────────────────────────────────────────────────────────────

const NEXT_STEPS: Record<PrayerChainStatus, { status: 'active' | 'paused'; label: string }[]> = {
  draft: [{ status: 'active', label: 'Start the chain' }],
  active: [{ status: 'paused', label: 'Pause' }],
  paused: [{ status: 'active', label: 'Resume' }],
  ended: [],
};

export function ChainStatusActions({ chainId, status }: { chainId: string; status: PrayerChainStatus }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: 'active' | 'paused') =>
    startTransition(async () => {
      setMessage(null);
      const result = await setChainStatusAction({ chainId, status: next });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error.message });
        return;
      }
      const created = result.data.generated?.slotsCreated ?? 0;
      setMessage({
        tone: 'success',
        text:
          next === 'paused'
            ? 'The chain is paused.'
            : created > 0
              ? `The chain is running. ${created.toLocaleString('en-PH')} slots were created.`
              : 'The chain is running.',
      });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {status !== 'ended' && (
        <div className="flex flex-wrap gap-2">
          {NEXT_STEPS[status].map((step) => (
            <Button key={step.status} size="sm" variant={step.status === 'paused' ? 'secondary' : undefined} disabled={pending} onClick={() => change(step.status)}>
              {pending ? 'Saving…' : step.label}
            </Button>
          ))}
          <ConfirmButton
            label="End the chain"
            title="End this prayer chain?"
            description="Its upcoming slots are cancelled, along with anyone assigned to them. Everything that already happened stays for reports. This can’t be undone."
            confirmLabel="End the chain"
            destructive
            run={() => setChainStatusAction({ chainId, status: 'ended' })}
          />
        </div>
      )}
    </div>
  );
}

// ─── Public page ──────────────────────────────────────────────────────────────

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      <Copy aria-hidden className="size-4" /> {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

// ─── Schedules ────────────────────────────────────────────────────────────────

const ScheduleForm = z
  .object({
    ...repeatShape,
    firstSlotTime: scheduleShape.firstSlotTime,
    slotMinutes: scheduleShape.slotMinutes,
    slotsPerOccurrence: scheduleShape.slotsPerOccurrence,
    capacity: scheduleShape.capacity,
    generateDaysAhead: scheduleShape.generateDaysAhead,
    effectiveFrom: scheduleShape.effectiveFrom,
    effectiveTo: scheduleShape.effectiveTo,
  })
  .superRefine((value, ctx) => {
    checkScheduleValues(value, ctx);
    checkWeekdays(value, ctx);
  })
  .transform(({ repeat, weekdays, ...schedule }) => ({ ...schedule, rrule: ruleFor(repeat, weekdays) }));

export function AddScheduleForm({ chainId, timezone, today }: { chainId: string; timezone: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: ScheduleForm,
    defaultValues: {
      repeat: 'daily',
      weekdays: [],
      firstSlotTime: '06:00',
      slotMinutes: 60,
      slotsPerOccurrence: 1,
      capacity: 1,
      generateDaysAhead: 14,
      effectiveFrom: today,
      effectiveTo: '',
    },
    action: (values) => addScheduleAction({ chainId, ...values }),
    onSuccess: (data) => {
      const created = data.generated?.slotsCreated ?? 0;
      setMessage(created > 0 ? `Schedule added. ${created.toLocaleString('en-PH')} new slots were created.` : 'Schedule added.');
      setOpen(false);
      form.reset();
      router.refresh();
    },
  });

  if (!open) {
    return (
      <div className="space-y-3">
        {message && <Alert tone="success">{message}</Alert>}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> Add a schedule
        </Button>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-line p-4">
        <h3 className="font-semibold">New schedule</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts on" type="date" {...form.register('effectiveFrom')} errors={errorsFor('effectiveFrom')} />
          <Field label="Ends on (optional)" type="date" {...form.register('effectiveTo')} errors={errorsFor('effectiveTo')} />
        </div>
        <SlotPatternFields startName="effectiveFrom" endName="effectiveTo" timezone={timezone} />
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add schedule'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

export function EndScheduleButton({ scheduleId, description }: { scheduleId: string; description: string }) {
  return (
    <ConfirmButton
      label="End"
      title="End this schedule?"
      description={description}
      confirmLabel="End schedule"
      destructive
      run={() => endScheduleAction({ scheduleId })}
    >
      <p>No more slots are created from it, and its upcoming slots are cancelled, along with anyone assigned to them.</p>
    </ConfirmButton>
  );
}

// ─── Standing commitments ─────────────────────────────────────────────────────

const CONFLICT_REASONS: Record<PlacementFailure, string> = {
  SLOT_CLOSED: 'the slot is no longer open',
  PERSON_UNAVAILABLE: 'they are no longer active',
  ALREADY_ASSIGNED: 'they are already on it',
  CAPACITY_FULL: 'the slot is already full',
  OVERLAP: 'they already pray at that time',
};

const CommitmentForm = z
  .object({
    personId: z.string().min(1, 'Choose who is praying'),
    ...repeatShape,
    localStartTime: timeOfDay,
    effectiveFrom: z.iso.date(),
    effectiveTo: z.preprocess((v) => (v === '' ? null : v), z.iso.date().nullish()),
  })
  .superRefine((value, ctx) => {
    checkWeekdays(value, ctx);
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
    }
  })
  .transform(({ repeat, weekdays, ...commitment }) => ({ ...commitment, rrule: ruleFor(repeat, weekdays) }));

interface CommitmentOutcome {
  name: string;
  placed: number;
  conflicts: { startsAt: Date; reason: PlacementFailure }[];
}

export function AddCommitmentForm({ chainId, timezone, today }: { chainId: string; timezone: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [outcome, setOutcome] = useState<CommitmentOutcome | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: CommitmentForm,
    defaultValues: { personId: '', repeat: 'weekly', weekdays: [], localStartTime: '', effectiveFrom: today, effectiveTo: '' },
    action: (values) => createCommitmentAction({ chainId, ...values }),
    onSuccess: (data) => {
      setOutcome({ name: person?.name ?? 'this person', placed: data.assignmentsCreated, conflicts: data.conflicts });
      setPerson(null);
      setOpen(false);
      form.reset();
      router.refresh();
    },
  });

  const when = (date: Date) =>
    new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(
      new Date(date),
    );

  if (!open) {
    return (
      <div className="space-y-3">
        {outcome && (
          <Alert tone={outcome.conflicts.length > 0 ? 'warning' : 'success'} title={`Commitment added for ${outcome.name}`}>
            <p>
              {outcome.placed > 0
                ? `They’re on ${outcome.placed} upcoming slot${outcome.placed === 1 ? '' : 's'}.`
                : 'They’ll be put on their slots as the chain creates them.'}
            </p>
            {outcome.conflicts.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {outcome.conflicts.slice(0, 5).map((conflict) => (
                  <li key={`${new Date(conflict.startsAt).toISOString()}-${conflict.reason}`}>
                    Not placed on {when(conflict.startsAt)}, because {CONFLICT_REASONS[conflict.reason]}.
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOutcome(null);
            setOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> Add a commitment
        </Button>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-line p-4">
        <h3 className="font-semibold">New standing commitment</h3>
        <div className="space-y-2">
          <p className="text-sm font-medium">Who prays</p>
          {person ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line-strong px-3 py-2">
              <span className="font-medium">{person.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPerson(null);
                  form.setValue('personId', '');
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <PeopleSearch
              chainId={chainId}
              onPick={(picked) => {
                setPerson(picked);
                form.setValue('personId', picked.personId, { shouldValidate: true });
              }}
            />
          )}
          <ErrorText errors={errorsFor('personId')} />
        </div>
        <RepeatFields legend="Prays" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Slot starts at" type="time" {...form.register('localStartTime')} errors={errorsFor('localStartTime')} />
          <Field label="From" type="date" {...form.register('effectiveFrom')} errors={errorsFor('effectiveFrom')} />
          <Field label="Until (optional)" type="date" {...form.register('effectiveTo')} errors={errorsFor('effectiveTo')} />
        </div>
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add commitment'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

export function EndCommitmentButton({ commitmentId, personName, pattern }: { commitmentId: string; personName: string; pattern: string }) {
  return (
    <ConfirmButton
      label="End"
      title={`End ${personName}’s commitment?`}
      description={pattern}
      confirmLabel="End commitment"
      destructive
      run={() => endCommitmentAction({ commitmentId })}
    >
      <p>They’re taken off the upcoming slots it gave them, and those personal links stop working.</p>
    </ConfirmButton>
  );
}

// ─── Coordinators ─────────────────────────────────────────────────────────────

const CoordinatorForm = z.object({
  personId: z.string().min(1, 'Choose a person'),
  email: z.string().trim().max(254),
});

export function AppointCoordinatorForm({ chainId }: { chainId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: CoordinatorForm,
    defaultValues: { personId: '', email: '' },
    action: (values) => appointCoordinatorAction({ chainId, ...values }),
    onSuccess: (data) => {
      setMessage(data.invited ? 'Invitation sent. Once they sign in, they can run this chain.' : 'Appointed. They can now run this chain.');
      setOpen(false);
      form.reset();
      router.refresh();
    },
  });

  if (!open) {
    return (
      <div className="space-y-3">
        {message && <Alert tone="success">{message}</Alert>}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> Appoint a coordinator
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-line p-4">
      <PersonPicker
        name="coordinatorPersonId"
        label="Person"
        errors={errorsFor('personId')}
        onChange={(value) => form.setValue('personId', value?.id ?? '', { shouldValidate: true })}
      />
      <Field label="Email" type="email" hint="Only needed if they don’t have a portal account yet." {...form.register('email')} errors={errorsFor('email')} />
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Appoint'}
        </Button>
      </div>
    </form>
  );
}

export function RemoveCoordinatorButton({ assignmentId, name }: { assignmentId: string; name: string }) {
  return (
    <ConfirmButton
      label="Remove"
      title={`Remove ${name} as coordinator?`}
      description="They stop running this chain. Any other roles they have stay as they are."
      confirmLabel="Remove"
      destructive
      run={() => removeCoordinatorAction({ assignmentId })}
    />
  );
}

// ─── Chain details ────────────────────────────────────────────────────────────

const DetailsForm = z.object(chainShape).superRefine(checkChainDates);

export interface ChainDetails {
  id: string;
  name: string;
  description: string | null;
  chainType: PrayerChainType;
  timezone: string;
  ministryId: string | null;
  startsOn: string;
  endsOn: string | null;
  graceMinutes: number;
  checkinOpensMinutes: number;
  requireCheckin: boolean;
  showNamesPublicly: boolean;
  collectsReports: boolean;
}

export function EditChainForm({
  chain,
  ministries,
  allowNoMinistry,
  fixedMinistryName,
}: {
  chain: ChainDetails;
  ministries: { id: string; name: string }[];
  allowNoMinistry: boolean;
  fixedMinistryName?: string | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError } = useActionForm({
    schema: DetailsForm,
    defaultValues: {
      name: chain.name,
      description: chain.description ?? '',
      chainType: chain.chainType,
      timezone: chain.timezone,
      ministryId: chain.ministryId ?? '',
      startsOn: chain.startsOn,
      endsOn: chain.endsOn ?? '',
      graceMinutes: chain.graceMinutes,
      checkinOpensMinutes: chain.checkinOpensMinutes,
      requireCheckin: chain.requireCheckin,
      showNamesPublicly: chain.showNamesPublicly,
      collectReports: chain.collectsReports,
    },
    action: (values) => updateChainAction({ chainId: chain.id, ...values }),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-6">
        <ChainBasicsFields ministries={ministries} allowNoMinistry={allowNoMinistry} fixedMinistryName={fixedMinistryName} />
        <ChainChoicesFields />
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">Saved.</Alert>}
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save details'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
