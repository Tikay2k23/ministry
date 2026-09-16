'use client';

import { MoreHorizontal, Plus, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, inputClassName } from '@/components/ui/field';
import {
  addUnavailabilityAction,
  addWorshipTeamMemberAction,
  createWorshipTeamAction,
  removeUnavailabilityAction,
  removeWorshipTeamMemberAction,
  setMemberServingRolesAction,
} from '../actions';
import { ServingPeopleSearch, type ServingPerson } from '../serving-people-search';

/** Worship team actions (docs/04 A21): members, their default roles, away dates, new teams. */

// ─── New team ─────────────────────────────────────────────────────────────────

const TeamForm = z.object({ ministryId: z.string().min(1, 'Choose the ministry'), name: z.string().trim().min(2, 'Enter a name').max(80) });

export function CreateTeamForm({ ministries }: { ministries: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: TeamForm,
    defaultValues: { ministryId: ministries[0]?.id ?? '', name: '' },
    action: createWorshipTeamAction,
    onSuccess: () => {
      form.reset();
      setOpen(false);
      router.refresh();
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" /> New worship team
      </Button>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="grid w-full gap-3 rounded-lg border border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      {ministries.length > 1 ? (
        <div className="space-y-1.5">
          <label htmlFor="team-ministry" className="block text-sm font-medium">
            Ministry
          </label>
          <select id="team-ministry" {...form.register('ministryId')} className={inputClassName}>
            {ministries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-muted">In {ministries[0]?.name}</p>
      )}
      <Field label="Team name" placeholder="Team A" {...form.register('name')} errors={errorsFor('name')} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add team'}
        </Button>
      </div>
      {formError && (
        <div className="sm:col-span-3">
          <Alert tone="error">{formError}</Alert>
        </div>
      )}
    </form>
  );
}

// ─── Add a member ─────────────────────────────────────────────────────────────

export function AddMemberButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = (person: ServingPerson) =>
    startTransition(async () => {
      setError(null);
      const result = await addWorshipTeamMemberAction({ teamId, personId: person.personId });
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
        <Button variant="secondary" size="sm">
          <UserPlus aria-hidden className="size-4" /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add someone to {teamName}</DialogTitle>
          <DialogDescription>Then choose the roles they usually play.</DialogDescription>
        </DialogHeader>
        {error && <Alert tone="error">{error}</Alert>}
        {open && <ServingPeopleSearch scope={{ teamId }} onPick={pick} disabled={pending} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── A member's roles ─────────────────────────────────────────────────────────

function RolesBody({
  membershipId,
  roles,
  initialRoleIds,
  initialPrimaryId,
  onDone,
}: {
  membershipId: string;
  roles: { id: string; name: string }[];
  initialRoleIds: string[];
  initialPrimaryId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialRoleIds);
  const [primary, setPrimary] = useState<string | null>(initialPrimaryId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (roleId: string, on: boolean) => {
    setSelected((current) => (on ? [...current, roleId] : current.filter((id) => id !== roleId)));
    if (!on && primary === roleId) setPrimary(null);
  };
  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await setMemberServingRolesAction({
        teamMembershipId: membershipId,
        servingRoleIds: selected,
        primaryRoleId: primary ?? (selected.length === 1 ? selected[0] : null),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="sr-only">Roles they play</legend>
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {roles.map((role) => {
            const on = selected.includes(role.id);
            return (
              <li key={role.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <label className="flex items-center gap-3">
                  <Checkbox checked={on} onCheckedChange={(checked) => toggle(role.id, checked === true)} />
                  {role.name}
                </label>
                {on && (
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="radio" name="primary-role" checked={primary === role.id} onChange={() => setPrimary(role.id)} className="size-4 accent-brand-deep" />
                    Main role
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p className="text-sm text-muted">Rosters are filled with people’s main role first.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <DialogFooter>
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save roles'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Away dates ───────────────────────────────────────────────────────────────

const AwayForm = z
  .object({ from: z.iso.date('Choose the first day'), to: z.iso.date('Choose the last day'), reason: z.string().trim().max(200) })
  .refine((value) => value.to >= value.from, { path: ['to'], message: 'The last day must be on or after the first day.' });

function AwayBody({ personId, today, onDone }: { personId: string; today: string; onDone: () => void }) {
  const router = useRouter();
  const [affected, setAffected] = useState<{ gatheringId: string; label: string }[] | null>(null);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: AwayForm,
    defaultValues: { from: today, to: today, reason: '' },
    action: (values) => addUnavailabilityAction({ personId, ...values }),
    onSuccess: (data) => {
      router.refresh();
      if (data.affected.length === 0) onDone();
      else setAffected(data.affected);
    },
  });

  if (affected) {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="They’re already on these rosters">
          <ul className="mt-1 list-disc pl-5">
            {affected.map((item) => (
              <li key={`${item.gatheringId}-${item.label}`}>
                <a href={`/app/devotional/${item.gatheringId}`} className="underline">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2">Open each roster to find a substitute.</p>
        </Alert>
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" type="date" {...form.register('from')} errors={errorsFor('from')} />
        <Field label="Last day" type="date" {...form.register('to')} errors={errorsFor('to')} />
      </div>
      <Field label="Reason (optional)" placeholder="Travelling" {...form.register('reason')} errors={errorsFor('reason')} />
      {formError && <Alert tone="error">{formError}</Alert>}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save away dates'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AwayChip({ unavailabilityId, label, canManage }: { unavailabilityId: string; label: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ground px-2.5 py-0.5 text-xs">
      {label}
      {canManage && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Remove away dates ${label}`}
          onClick={() =>
            startTransition(async () => {
              await removeUnavailabilityAction({ unavailabilityId });
              router.refresh();
            })
          }
          className="rounded-full p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </span>
  );
}

// ─── The menu beside each member ──────────────────────────────────────────────

type MemberDialog = 'roles' | 'away' | 'remove';

export function MemberMenu({
  member,
  teamName,
  roles,
  today,
}: {
  member: { membershipId: string; personId: string; name: string; roleIds: string[]; primaryRoleId: string | null };
  teamName: string;
  roles: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => setDialog(null);
  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await removeWorshipTeamMemberAction({ teamMembershipId: member.membershipId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      close();
      router.refresh();
    });
  const titles: Record<MemberDialog, string> = {
    roles: `${member.name}’s roles`,
    away: `Days ${member.name} is away`,
    remove: `Remove ${member.name} from ${teamName}?`,
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={`Actions for ${member.name}`}>
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('roles')}>Roles they play</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('away')}>Add away dates</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('remove')}>
            Remove from team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog ? titles[dialog] : ''}</DialogTitle>
            <DialogDescription>
              {dialog === 'away'
                ? 'Rosters won’t be filled with them on these days, and coordinators see a warning.'
                : dialog === 'remove'
                  ? 'Rosters already made keep them; new rosters won’t include them.'
                  : 'The roles they usually play on this team.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'roles' && (
            <RolesBody membershipId={member.membershipId} roles={roles} initialRoleIds={member.roleIds} initialPrimaryId={member.primaryRoleId} onDone={close} />
          )}
          {dialog === 'away' && <AwayBody personId={member.personId} today={today} onDone={close} />}
          {dialog === 'remove' && (
            <div className="space-y-4">
              {error && <Alert tone="error">{error}</Alert>}
              <DialogFooter>
                <Button variant="danger" onClick={remove} disabled={pending}>
                  {pending ? 'Removing…' : 'Remove from team'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
