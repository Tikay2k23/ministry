'use client';

import { useMemo } from 'react';
import { Controller, get, useFormContext, useFormState, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select-field';
import { Field, inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { formatSlotRange } from '@/lib/time-range';
import { PRAYER_CHAIN_TYPES } from '@/server/db/enums';
import { addDays } from '@/server/modules/journal/journal-dates';
import { describeSchedule } from '@/server/modules/prayer/prayer.schemas';
import { expandDates, parseRecurrence, WEEKDAYS, type Weekday } from '@/server/modules/prayer/recurrence';
import { isValidTimeZone, slotsForOccurrence } from '@/server/modules/prayer/slot-times';
import { CHAIN_TYPE_LABELS } from './labels';

/**
 * Form sections shared by the prayer chain forms: a new chain, its details, a schedule and a
 * standing commitment. Each section reads its form from context, so render it inside `<FormProvider>`.
 */

type AddIssue = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

const WEEKDAY_LABELS: Record<Weekday, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };

/** A field's error messages from the surrounding form, in the shape the `Field` component takes. */
function useErrorsFor() {
  const { errors } = useFormState();
  return (name: string): string[] | undefined => {
    const message: unknown = get(errors, name)?.message;
    return typeof message === 'string' && message ? [message] : undefined;
  };
}

export function ErrorText({ errors }: { errors?: string[] }) {
  return errors ? (
    <p className="text-sm text-error" role="alert">
      {errors.join(' ')}
    </p>
  ) : null;
}

// ─── Repeat: every day, or on certain days ───────────────────────────────────

export const repeatShape = {
  repeat: z.enum(['daily', 'weekly']),
  weekdays: z.array(z.enum(WEEKDAYS)),
};

export function checkWeekdays(value: { repeat: 'daily' | 'weekly'; weekdays: readonly Weekday[] }, ctx: AddIssue) {
  if (value.repeat === 'weekly' && value.weekdays.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose at least one day.' });
  }
}

/** The recurrence rule for a repeat choice, with the days in calendar order. */
export function ruleFor(repeat: unknown, weekdays: unknown): string {
  if (repeat !== 'weekly') return 'FREQ=DAILY';
  const chosen: unknown[] = Array.isArray(weekdays) ? weekdays : [];
  return `FREQ=WEEKLY;BYDAY=${WEEKDAYS.filter((day) => chosen.includes(day)).join(',')}`;
}

export function RepeatFields({ legend = 'Repeats' }: { legend?: string }) {
  const { control, register } = useFormContext<{ repeat: 'daily' | 'weekly'; weekdays: Weekday[] }>();
  const repeat = useWatch({ control, name: 'repeat' });
  const errorsFor = useErrorsFor();

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{legend}</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" value="daily" {...register('repeat')} className="size-4 accent-brand-deep" /> Every day
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="weekly" {...register('repeat')} className="size-4 accent-brand-deep" /> On certain days
          </label>
        </div>
      </fieldset>
      {repeat === 'weekly' && (
        <Controller
          control={control}
          name="weekdays"
          render={({ field }) => (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">On these days</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(day)}
                      onCheckedChange={(checked) => field.onChange(checked === true ? [...field.value, day] : field.value.filter((d) => d !== day))}
                    />
                    {WEEKDAY_LABELS[day]}
                  </label>
                ))}
              </div>
              <ErrorText errors={errorsFor('weekdays')} />
            </fieldset>
          )}
        />
      )}
    </div>
  );
}

// ─── The slot pattern, with a preview ─────────────────────────────────────────

type PatternValues = {
  repeat: 'daily' | 'weekly';
  weekdays: Weekday[];
  firstSlotTime: string;
  slotMinutes: number | string;
  slotsPerOccurrence: number | string;
  capacity: number | string;
  timezone?: string;
  startsOn?: string;
  endsOn?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

/**
 * How a schedule repeats and how long its slots are, previewed in plain language with its next
 * occurrences (docs/04 A18, docs/05 W10 step 2). The time zone comes from the prop, or else from
 * the form's own `timezone` field.
 */
export function SlotPatternFields({
  startName,
  endName,
  timezone,
}: {
  startName: 'startsOn' | 'effectiveFrom';
  endName: 'endsOn' | 'effectiveTo';
  timezone?: string;
}) {
  const { control, register } = useFormContext<PatternValues>();
  const values = useWatch({ control }) as Partial<PatternValues>;
  const errorsFor = useErrorsFor();

  const preview = useMemo(() => {
    const rrule = ruleFor(values.repeat, values.weekdays);
    const rule = parseRecurrence(rrule);
    const minutes = Number(values.slotMinutes);
    const count = Number(values.slotsPerOccurrence);
    const start = values[startName] ?? '';
    const end = values[endName] || null;
    const zone = (timezone ?? values.timezone ?? '').trim();
    const time = values.firstSlotTime ?? '';
    if (!rule || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    if (!Number.isInteger(minutes) || !Number.isInteger(count) || minutes < 5 || count < 1 || minutes * count > 1440) return null;
    if (!isValidTimeZone(zone)) return null;

    const schedule = { rrule, firstSlotTime: time, slotMinutes: minutes, slotsPerOccurrence: count };
    const occurrences = expandDates(rule, { from: start, to: addDays(start, 28) }, { from: start, to: end })
      .slice(0, 3)
      .map((date) => {
        const slots = slotsForOccurrence(date, schedule, zone);
        return formatSlotRange(slots[0]!.startsAt, slots.at(-1)!.endsAt, zone, { withDate: true });
      });
    return { description: describeSchedule(schedule), occurrences };
  }, [values, startName, endName, timezone]);

  return (
    <div className="space-y-4">
      <RepeatFields />
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="First slot starts at" type="time" {...register('firstSlotTime')} errors={errorsFor('firstSlotTime')} />
        <Field label="Minutes per slot" type="number" min={5} max={1440} {...register('slotMinutes')} errors={errorsFor('slotMinutes')} />
        <Field label="Slots each time" type="number" min={1} max={288} {...register('slotsPerOccurrence')} errors={errorsFor('slotsPerOccurrence')} />
        <Field label="People per slot" type="number" min={1} max={50} {...register('capacity')} errors={errorsFor('capacity')} />
      </div>
      {preview && (
        <div className="rounded-lg bg-ground px-4 py-3 text-sm" aria-live="polite">
          <p className="font-medium">{preview.description}</p>
          {preview.occurrences.length > 0 ? (
            <ul className="mt-1 text-muted">
              {preview.occurrences.map((occurrence) => (
                <li key={occurrence}>{occurrence}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">No days in the next four weeks match.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chain details ────────────────────────────────────────────────────────────

type ChainValues = {
  name: string;
  description: string;
  chainType: string;
  timezone: string;
  ministryId: string;
  startsOn: string;
  endsOn: string;
  graceMinutes: number | string;
  checkinOpensMinutes: number | string;
  requireCheckin: boolean;
  showNamesPublicly: boolean;
  allowSelfSignup: boolean;
  collectReports: boolean;
  reportPhoto: 'required' | 'optional' | 'off';
};

export function ChainBasicsFields({
  ministries,
  allowNoMinistry,
  fixedMinistryName,
}: {
  /** The ministries the chain may belong to. When there is no choice, `fixedMinistryName` is shown instead. */
  ministries: { id: string; name: string }[];
  allowNoMinistry: boolean;
  fixedMinistryName?: string | null;
}) {
  const { register } = useFormContext<ChainValues>();
  const errorsFor = useErrorsFor();

  return (
    <div className="space-y-4">
      <Field label="Name" placeholder="Night and Day Prayer" {...register('name')} errors={errorsFor('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="chainType" className="block text-sm font-medium">
            Kind of chain
          </label>
          <select id="chainType" {...register('chainType')} className={inputClassName}>
            {PRAYER_CHAIN_TYPES.map((type) => (
              <option key={type} value={type}>
                {CHAIN_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        {ministries.length > 0 ? (
          <div className="space-y-1.5">
            <label htmlFor="ministryId" className="block text-sm font-medium">
              Ministry
            </label>
            <select id="ministryId" {...register('ministryId')} className={inputClassName}>
              {allowNoMinistry && <option value="">No particular ministry</option>}
              {ministries.map((ministry) => (
                <option key={ministry.id} value={ministry.id}>
                  {ministry.name}
                </option>
              ))}
            </select>
            <ErrorText errors={errorsFor('ministryId')} />
          </div>
        ) : fixedMinistryName !== undefined ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Ministry</p>
            <p className="flex h-10 items-center text-muted">{fixedMinistryName ?? 'No particular ministry'}</p>
          </div>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium">
          Description <span className="font-normal text-muted">(optional, shown on the public page)</span>
        </label>
        <textarea id="description" rows={2} maxLength={1000} {...register('description')} className={cn(inputClassName, 'h-auto py-2')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Starts on" type="date" {...register('startsOn')} errors={errorsFor('startsOn')} />
        <Field label="Ends on (optional)" type="date" {...register('endsOn')} errors={errorsFor('endsOn')} />
        <Field label="Time zone" {...register('timezone')} errors={errorsFor('timezone')} />
      </div>
    </div>
  );
}

export function ChainChoicesFields() {
  const { control, register } = useFormContext<ChainValues>();
  const errorsFor = useErrorsFor();

  const choice = (name: 'requireCheckin' | 'showNamesPublicly' | 'allowSelfSignup' | 'collectReports', label: string, hint: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start gap-3">
          <Checkbox
            checked={field.value === true}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            onBlur={field.onBlur}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-sm text-muted">{hint}</span>
          </span>
        </label>
      )}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Minutes of grace after a slot"
          type="number"
          min={0}
          max={240}
          hint="How long people have to mark a slot finished before a gentle follow-up."
          {...register('graceMinutes')}
          errors={errorsFor('graceMinutes')}
        />
        <Field
          label="Check-in opens (minutes before)"
          type="number"
          min={0}
          max={120}
          {...register('checkinOpensMinutes')}
          errors={errorsFor('checkinOpensMinutes')}
        />
      </div>
      {choice('requireCheckin', 'Ask people to check in when they start', 'Otherwise they can simply mark the slot finished.')}
      {choice('showNamesPublicly', 'Show first names on the public page', 'For example “Now praying: Mary”. Off keeps names private.')}
      {choice(
        'allowSelfSignup',
        'Let people choose their own hour',
        'The public page shows every hour, and anyone in the ministry can take one that is still open.',
      )}
      {choice('collectReports', 'Invite a short report after each slot', 'A report, a testimony or a prayer request, which only pastors read.')}
      <SelectField
        label="A photo with the report"
        hint="A picture from their prayer time. Only pastors and pastoral care ever see it."
        options={[
          { value: 'optional', label: 'Invited, but not needed' },
          { value: 'required', label: 'Asked for with every report' },
          { value: 'off', label: 'Not collected' },
        ]}
        {...register('reportPhoto')}
        errors={errorsFor('reportPhoto')}
      />
    </div>
  );
}
