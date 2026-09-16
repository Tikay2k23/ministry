'use client';

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { PersonPicker } from '@/components/portal/person-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { ROTATION_MODES } from '@/server/db/enums';
import type { Result } from '@/server/errors';
import { describeGatheringSchedule, ROTATION_LABELS, timeOfDay } from '@/server/modules/devotional/devotional.schemas';
import { teamIndexFor, upcomingOccurrences } from '@/server/modules/devotional/rotation';
import { parseRecurrence, WEEKDAYS } from '@/server/modules/scheduling/recurrence';
import {
  appointWorshipCoordinatorAction,
  createOneOffGatheringAction,
  createScheduleAction,
  endScheduleAction,
  removeWorshipCoordinatorAction,
  setRosterTemplateAction,
  updateGatheringTypeAction,
} from '../../actions';
import { checkRepeatChoice, ORDINAL_NAMES, ORDINALS, repeatChoiceShape, ruleForChoice, shortDate, WEEKDAY_NAMES } from '../../schedule-rule';

/** A gathering type's setup forms (docs/04 A21, docs/05 W8 steps 1–3). */

type TeamOption = { id: string; name: string };

// ─── A button that asks first ─────────────────────────────────────────────────

function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  run,
  children,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<Result<unknown>>;
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
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
          <Button variant="danger" onClick={confirm} disabled={pending}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EndScheduleButton({ scheduleId, name }: { scheduleId: string; name: string }) {
  return (
    <ConfirmButton
      label="End"
      title={`End “${name}”?`}
      description="No more gatherings are created from it, and its upcoming gatherings are cancelled. People who confirmed are told."
      confirmLabel="End schedule"
      run={() => endScheduleAction({ scheduleId })}
    />
  );
}

export function RemoveCoordinatorButton({ assignmentId, name }: { assignmentId: string; name: string }) {
  return (
    <ConfirmButton
      label="Remove"
      title={`Remove ${name} as coordinator?`}
      description="They stop running this gathering. Any other roles they have stay as they are."
      confirmLabel="Remove"
      run={() => removeWorshipCoordinatorAction({ assignmentId })}
    />
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

const ScheduleForm = z
  .object({
    name: z.string().trim().min(1, 'Name the schedule').max(80),
    ...repeatChoiceShape,
    startTime: timeOfDay,
    durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
    effectiveFrom: z.iso.date('Choose a start date'),
    effectiveTo: z.string(),
    rotationMode: z.enum(ROTATION_MODES),
    teamIds: z.array(z.string()),
    rotationAnchor: z.string(),
    generateDaysAhead: z.coerce.number().int().min(1, 'At least 1 day').max(180, 'At most 180 days'),
  })
  .superRefine((value, ctx) => {
    checkRepeatChoice(value, ctx);
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
    }
    if (value.rotationMode === 'none') {
      if (value.teamIds.length > 1) ctx.addIssue({ code: 'custom', path: ['teamIds'], message: 'Choose one team, or rotate between teams.' });
      return;
    }
    if (value.teamIds.length < 2) ctx.addIssue({ code: 'custom', path: ['teamIds'], message: 'Choose at least two teams to rotate.' });
    if (!value.rotationAnchor) ctx.addIssue({ code: 'custom', path: ['rotationAnchor'], message: 'Choose when the first team serves.' });
  })
  .transform(({ repeat, weekdays, monthMode, ordinal, monthWeekday, monthDay, ...rest }) => ({
    ...rest,
    rrule: ruleForChoice({ repeat, weekdays, monthMode, ordinal, monthWeekday, monthDay }),
    effectiveTo: rest.effectiveTo || null,
    rotationAnchor: rest.rotationMode === 'none' ? null : rest.rotationAnchor || null,
  }));

function ErrorText({ errors }: { errors?: string[] }) {
  return errors ? (
    <p className="text-sm text-error" role="alert">
      {errors.join(' ')}
    </p>
  ) : null;
}

export function AddScheduleForm({
  gatheringTypeId,
  defaultStartTime,
  defaultDurationMinutes,
  teams,
  today,
}: {
  gatheringTypeId: string;
  defaultStartTime: string;
  defaultDurationMinutes: number;
  teams: TeamOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: ScheduleForm,
    defaultValues: {
      name: '',
      repeat: 'weekly',
      weekdays: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA'],
      monthMode: 'weekday',
      ordinal: '1',
      monthWeekday: 'SU',
      monthDay: '1',
      startTime: defaultStartTime,
      durationMinutes: defaultDurationMinutes,
      effectiveFrom: today,
      effectiveTo: '',
      rotationMode: teams.length > 1 ? 'weekly' : 'none',
      teamIds: [],
      rotationAnchor: today,
      generateDaysAhead: 56,
    },
    action: (values) => createScheduleAction({ gatheringTypeId, ...values }),
    onSuccess: (data) => {
      const { gatheringsCreated, gaps } = data.generated;
      setMessage(
        gatheringsCreated === 0
          ? 'Schedule added. Its gatherings will be created as their dates come into view.'
          : `Schedule added: ${gatheringsCreated} gatherings created${gaps > 0 ? `, with ${gaps} roles still to fill` : ''}.`,
      );
      form.reset();
      setOpen(false);
      router.refresh();
    },
  });
  const values = useWatch({ control: form.control });
  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? 'Team';

  // The next six gatherings with their teams, exactly as the generator will create them.
  const preview = useMemo(() => {
    const rrule = ruleForChoice(values as Parameters<typeof ruleForChoice>[0]);
    const rule = parseRecurrence(rrule);
    const from = values.effectiveFrom ?? '';
    const minutes = Number(values.durationMinutes);
    if (!rule || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.startTime ?? '') || !(minutes >= 5)) return null;
    const teamIds = (values.teamIds ?? []).filter((id): id is string => typeof id === 'string');
    const schedule = {
      rrule,
      effectiveFrom: from,
      effectiveTo: values.effectiveTo || null,
      rotationMode: values.rotationMode ?? 'none',
      rotationAnchor: values.rotationMode === 'none' ? null : values.rotationAnchor || null,
    };
    const dates = upcomingOccurrences(schedule, today > from ? today : from, 6);
    return {
      description: describeGatheringSchedule({ rrule, startTime: values.startTime!, durationMinutes: minutes }),
      occurrences: dates.map((date) => {
        const index = schedule.rotationMode !== 'none' && !schedule.rotationAnchor ? null : teamIndexFor(schedule, teamIds.length, date);
        return { date, team: index === null ? null : teamName(teamIds[index]!) };
      }),
    };
    // teamName only reads `teams`, which is part of the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, today, teams]);

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

  const repeat = values.repeat;
  const rotating = values.rotationMode !== 'none';
  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-lg border border-line p-4">
      <h3 className="font-semibold">New schedule</h3>
      <Field label="Name" placeholder="Weekday mornings" {...form.register('name')} errors={errorsFor('name')} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeats</legend>
        <div className="flex flex-wrap gap-4">
          {(['daily', 'weekly', 'monthly'] as const).map((choice) => (
            <label key={choice} className="flex items-center gap-2">
              <input
                type="radio"
                value={choice}
                {...form.register('repeat', {
                  // Week-by-week turns don't fit a monthly gathering: each month is the next team's turn.
                  onChange: (event: { target: { value: string } }) => {
                    if (event.target.value === 'monthly' && form.getValues('rotationMode') === 'weekly') form.setValue('rotationMode', 'per_occurrence');
                  },
                })}
                className="size-4 accent-brand-deep"
              />
              {choice === 'daily' ? 'Every day' : choice === 'weekly' ? 'On certain days' : 'Once a month'}
            </label>
          ))}
        </div>
      </fieldset>

      {repeat === 'weekly' && (
        <Controller
          control={form.control}
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
                    {WEEKDAY_NAMES[day].slice(0, 3)}
                  </label>
                ))}
              </div>
              <ErrorText errors={errorsFor('weekdays')} />
            </fieldset>
          )}
        />
      )}

      {repeat === 'monthly' && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">On</legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" value="weekday" {...form.register('monthMode')} className="size-4 accent-brand-deep" />
            the
            <select aria-label="Which week" {...form.register('ordinal')} className={cn(inputClassName, 'w-auto')}>
              {ORDINALS.map((ordinal) => (
                <option key={ordinal} value={ordinal}>
                  {ORDINAL_NAMES[ordinal]}
                </option>
              ))}
            </select>
            <select aria-label="Day of the week" {...form.register('monthWeekday')} className={cn(inputClassName, 'w-auto')}>
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {WEEKDAY_NAMES[day]}
                </option>
              ))}
            </select>
            of the month
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" value="day" {...form.register('monthMode')} className="size-4 accent-brand-deep" />
            day
            <select aria-label="Day of the month" {...form.register('monthDay')} className={cn(inputClassName, 'w-auto')}>
              {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
              <option value="-1">last</option>
            </select>
            of the month
          </label>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at" type="time" {...form.register('startTime')} errors={errorsFor('startTime')} />
        <Field label="Minutes" type="number" min={5} max={600} {...form.register('durationMinutes')} errors={errorsFor('durationMinutes')} />
        <Field label="From" type="date" {...form.register('effectiveFrom')} errors={errorsFor('effectiveFrom')} />
        <Field label="Until (optional)" type="date" {...form.register('effectiveTo')} errors={errorsFor('effectiveTo')} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Teams</legend>
        <div className="flex flex-wrap gap-4">
          {ROTATION_MODES.filter((mode) => repeat !== 'monthly' || mode !== 'weekly').map((mode) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                value={mode}
                {...form.register('rotationMode', {
                  onChange: (event: { target: { value: string } }) => {
                    if (event.target.value === 'none') form.setValue('teamIds', form.getValues('teamIds').slice(0, 1));
                  },
                })}
                className="size-4 accent-brand-deep"
              />
              {ROTATION_LABELS[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      <Controller
        control={form.control}
        name="teamIds"
        render={({ field }) =>
          !rotating ? (
            <div className="space-y-1.5">
              <label htmlFor="schedule-team" className="block text-sm font-medium">
                Team <span className="font-normal text-muted">(optional)</span>
              </label>
              <select
                id="schedule-team"
                value={field.value[0] ?? ''}
                onChange={(e) => field.onChange(e.target.value ? [e.target.value] : [])}
                className={inputClassName}
              >
                <option value="">No team — fill the roster by hand</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Rotation order</p>
              {field.value.length > 0 && (
                <ol className="space-y-1">
                  {field.value.map((teamId, index) => {
                    const move = (by: number) => {
                      const next = [...field.value];
                      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
                      field.onChange(next);
                    };
                    return (
                      <li key={`${teamId}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                        <span>
                          {index + 1}. {teamName(teamId)}
                        </span>
                        <span className="flex">
                          <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(-1)} aria-label={`Move ${teamName(teamId)} earlier`}>
                            <ArrowUp aria-hidden className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={index === field.value.length - 1}
                            onClick={() => move(1)}
                            aria-label={`Move ${teamName(teamId)} later`}
                          >
                            <ArrowDown aria-hidden className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => field.onChange(field.value.filter((_, i) => i !== index))}
                            aria-label={`Remove ${teamName(teamId)} from the rotation`}
                          >
                            <X aria-hidden className="size-4" />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <select
                aria-label="Add a team to the rotation"
                value=""
                onChange={(e) => e.target.value && field.onChange([...field.value, e.target.value])}
                className={inputClassName}
              >
                <option value="">Add a team…</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <ErrorText errors={errorsFor('teamIds')} />
            </div>
          )
        }
      />
      {rotating && (
        <Field
          label={values.rotationMode === 'weekly' ? 'The first team serves the week of' : 'The first team serves on'}
          type="date"
          {...form.register('rotationAnchor')}
          errors={errorsFor('rotationAnchor')}
        />
      )}
      <Field
        label="Create gatherings this many days ahead"
        type="number"
        min={1}
        max={180}
        hint="Rosters are filled when gatherings are created, and stay drafts until you publish them."
        {...form.register('generateDaysAhead')}
        errors={errorsFor('generateDaysAhead')}
      />

      {preview && (
        <div className="rounded-lg bg-ground px-4 py-3 text-sm" aria-live="polite">
          <p className="font-medium">{preview.description}</p>
          {preview.occurrences.length === 0 ? (
            <p className="mt-1 text-muted">No dates in the coming year match.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-muted">
              {preview.occurrences.map((occurrence) => (
                <li key={occurrence.date}>
                  {shortDate(occurrence.date)}
                  {occurrence.team ? ` · ${occurrence.team}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
  );
}

// ─── Roster template ──────────────────────────────────────────────────────────

interface TemplateRow {
  servingRoleId: string;
  minCount: string;
  maxCount: string;
}

export function RosterTemplateEditor({
  gatheringTypeId,
  roles,
  template,
}: {
  gatheringTypeId: string;
  roles: { id: string; name: string }[];
  template: { servingRoleId: string; name: string; minCount: number; maxCount: number }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[]>(template.map((t) => ({ servingRoleId: t.servingRoleId, minCount: String(t.minCount), maxCount: String(t.maxCount) })));
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const names = new Map([...template.map((t) => [t.servingRoleId, t.name] as const), ...roles.map((r) => [r.id, r.name] as const)]);
  const available = roles.filter((role) => !rows.some((row) => row.servingRoleId === role.id));

  const update = (index: number, patch: Partial<TemplateRow>) => {
    setMessage(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const move = (index: number, by: number) =>
    setRows((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });
  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await setRosterTemplateAction({
        gatheringTypeId,
        roles: rows.map((row) => ({ servingRoleId: row.servingRoleId, minCount: Number(row.minCount), maxCount: Number(row.maxCount) })),
      });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error.fieldErrors ? 'Each role needs at least as many places as people needed.' : result.error.message });
        return;
      }
      setMessage({ tone: 'success', text: 'Saved. New rosters use this template.' });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No roles yet. Add the roles every gathering needs.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs tracking-wider text-muted uppercase">
              <tr>
                <th className="py-2 font-semibold">Role</th>
                <th className="py-2 font-semibold">Needed</th>
                <th className="py-2 font-semibold">Up to</th>
                <th className="py-2">
                  <span className="sr-only">Order</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => {
                const name = names.get(row.servingRoleId) ?? 'Role';
                return (
                  <tr key={row.servingRoleId}>
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        aria-label={`${name}: people needed`}
                        value={row.minCount}
                        onChange={(e) => update(index, { minCount: e.target.value })}
                        className={cn(inputClassName, 'w-20')}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        aria-label={`${name}: most people`}
                        value={row.maxCount}
                        onChange={(e) => update(index, { maxCount: e.target.value })}
                        className={cn(inputClassName, 'w-20')}
                      />
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${name} up`}>
                        <ArrowUp aria-hidden className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${name} down`}>
                        <ArrowDown aria-hidden className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${name}`}>
                        <X aria-hidden className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">“Needed” of 0 makes a role optional: it’s filled when the team has someone, and never counts as open.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {available.length > 0 ? (
          <select
            aria-label="Add a role"
            value=""
            onChange={(e) => e.target.value && setRows((current) => [...current, { servingRoleId: e.target.value, minCount: '1', maxCount: '1' }])}
            className={cn(inputClassName, 'w-auto')}
          >
            <option value="">Add a role…</option>
            {available.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}

// ─── One-off gathering ────────────────────────────────────────────────────────

const OneOffForm = z.object({
  date: z.iso.date('Choose a date'),
  startTime: timeOfDay,
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  teamId: z.string(),
  title: z.string().trim().max(120),
});

export function OneOffGatheringForm({
  gatheringTypeId,
  teams,
  defaultStartTime,
  defaultDurationMinutes,
  today,
}: {
  gatheringTypeId: string;
  teams: TeamOption[];
  defaultStartTime: string;
  defaultDurationMinutes: number;
  today: string;
}) {
  const router = useRouter();
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: OneOffForm,
    defaultValues: { date: today, startTime: defaultStartTime, durationMinutes: defaultDurationMinutes, teamId: '', title: '' },
    action: (values) => createOneOffGatheringAction({ gatheringTypeId, ...values, teamId: values.teamId || null }),
    onSuccess: (data) => router.push(`/app/devotional/${data.gatheringId}`),
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" type="date" {...form.register('date')} errors={errorsFor('date')} />
        <Field label="Starts at" type="time" {...form.register('startTime')} errors={errorsFor('startTime')} />
        <Field label="Minutes" type="number" min={5} max={600} {...form.register('durationMinutes')} errors={errorsFor('durationMinutes')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="one-off-team" className="block text-sm font-medium">
            Team <span className="font-normal text-muted">(fills the roster)</span>
          </label>
          <select id="one-off-team" {...form.register('teamId')} className={inputClassName}>
            <option value="">No team — fill it by hand</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <Field label="Title (optional)" placeholder="Prayer and worship night" {...form.register('title')} errors={errorsFor('title')} />
      </div>
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Creating…' : 'Create gathering'}
        </Button>
      </div>
    </form>
  );
}

// ─── Details ──────────────────────────────────────────────────────────────────

const DetailsForm = z.object({
  name: z.string().trim().min(1, 'Name the gathering').max(80),
  defaultStartTime: timeOfDay,
  defaultDurationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  ministryId: z.string(),
  responseLockHours: z.coerce.number().int().min(0).max(168),
  isActive: z.boolean(),
});

export function GatheringTypeDetailsForm({
  type,
  ministries,
  allowNoMinistry,
}: {
  type: { id: string; name: string; defaultStartTime: string; defaultDurationMinutes: number; ministryId: string | null; ministryName: string | null; responseLockHours: number; isActive: boolean };
  ministries: { id: string; name: string }[];
  allowNoMinistry: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: DetailsForm,
    defaultValues: {
      name: type.name,
      defaultStartTime: type.defaultStartTime,
      defaultDurationMinutes: type.defaultDurationMinutes,
      ministryId: type.ministryId ?? '',
      responseLockHours: type.responseLockHours,
      isActive: type.isActive,
    },
    action: (values) => updateGatheringTypeAction({ gatheringTypeId: type.id, ...values, ministryId: values.ministryId || null }),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <Field label="Name" {...form.register('name')} errors={errorsFor('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Usual start time" type="time" {...form.register('defaultStartTime')} errors={errorsFor('defaultStartTime')} />
        <Field label="Minutes" type="number" min={5} max={600} {...form.register('defaultDurationMinutes')} errors={errorsFor('defaultDurationMinutes')} />
      </div>
      {ministries.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="details-ministry" className="block text-sm font-medium">
            Ministry
          </label>
          <select id="details-ministry" {...form.register('ministryId')} className={inputClassName}>
            {allowNoMinistry && <option value="">No particular ministry</option>}
            {ministries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-muted">Ministry: {type.ministryName ?? 'No particular ministry'}</p>
      )}
      <Field
        label="Replies can be changed until (hours before)"
        type="number"
        min={0}
        max={168}
        {...form.register('responseLockHours')}
        errors={errorsFor('responseLockHours')}
      />
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <label className="flex items-start gap-3">
            <Checkbox checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">In use</span>
              <span className="block text-sm text-muted">When switched off, no new gatherings are created. Existing ones stay.</span>
            </span>
          </label>
        )}
      />
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}

// ─── Coordinators ─────────────────────────────────────────────────────────────

const CoordinatorForm = z.object({ personId: z.string().min(1, 'Choose a person'), email: z.string().trim().max(254) });

export function AppointCoordinatorForm({ gatheringTypeId }: { gatheringTypeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: CoordinatorForm,
    defaultValues: { personId: '', email: '' },
    action: (values) => appointWorshipCoordinatorAction({ gatheringTypeId, ...values }),
    onSuccess: (data) => {
      setMessage(data.invited ? 'Invitation sent. Once they sign in, they can run this gathering.' : 'Appointed. They can now run this gathering.');
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
