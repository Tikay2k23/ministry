'use client';

import { MoreHorizontal, RotateCcw, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { GatheringAssignmentStatus } from '@/server/db/enums';
import {
  assignServingAction,
  cancelGatheringAction,
  rebuildRosterAction,
  removeServingAction,
  shareServingLinkAction,
  substituteServingAction,
  suggestServingSubstitutesAction,
  updateGatheringAction,
} from '../actions';
import { PublishRostersButton } from '../publish-week-button';
import { pickButtonClass, ServingPeopleSearch, type ServingPerson } from '../serving-people-search';

/** A gathering's roster actions (docs/04 A20): assign, substitute, remove, share a link, publish, rebuild, cancel. */

// ─── Header: publish, rebuild, cancel ─────────────────────────────────────────

export function RosterHeaderActions({ gatheringId, canPublish, canRebuild }: { gatheringId: string; canPublish: boolean; canRebuild: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canPublish && <PublishRostersButton gatheringIds={[gatheringId]} label="Publish roster" />}
      {canRebuild && <RebuildButton gatheringId={gatheringId} />}
      <CancelGatheringButton gatheringId={gatheringId} />
    </div>
  );
}

function RebuildButton({ gatheringId }: { gatheringId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rebuild = () =>
    startTransition(async () => {
      setError(null);
      const result = await rebuildRosterAction({ gatheringId });
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
        <Button variant="secondary">
          <RotateCcw aria-hidden className="size-4" /> Fill again from the team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fill this roster again?</DialogTitle>
          <DialogDescription>Everyone on this draft roster is replaced by the team’s default roles, as when it was first created. Nobody has been told yet.</DialogDescription>
        </DialogHeader>
        {error && <Alert tone="error">{error}</Alert>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button onClick={rebuild} disabled={pending}>
            {pending ? 'Filling…' : 'Fill again'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CancelForm = z.object({ reason: z.string().trim().min(3, 'Please give a short reason').max(300) });

function CancelBody({ gatheringId, onDone }: { gatheringId: string; onDone: () => void }) {
  const router = useRouter();
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: CancelForm,
    defaultValues: { reason: '' },
    action: (values) => cancelGatheringAction({ gatheringId, ...values }),
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Reason" placeholder="Typhoon signal no. 2" hint="People who confirmed are told, with this reason." {...form.register('reason')} errors={errorsFor('reason')} />
      {formError && <Alert tone="error">{formError}</Alert>}
      <DialogFooter>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? 'Cancelling…' : 'Cancel the gathering'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CancelGatheringButton({ gatheringId }: { gatheringId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Cancel gathering</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this gathering?</DialogTitle>
          <DialogDescription>Everyone comes off the roster and their links stop working. This can’t be undone.</DialogDescription>
        </DialogHeader>
        {open && <CancelBody gatheringId={gatheringId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Assign ───────────────────────────────────────────────────────────────────

export function AssignButton({ gatheringId, servingRoleId, roleName }: { gatheringId: string; servingRoleId: string; roleName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = (person: ServingPerson) =>
    startTransition(async () => {
      setError(null);
      const result = await assignServingAction({ gatheringId, servingRoleId, personId: person.personId });
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
        <Button variant="secondary" size="sm" aria-label={`Add someone as ${roleName}`}>
          <UserPlus aria-hidden className="size-4" /> Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add someone as {roleName}</DialogTitle>
          <DialogDescription>If the roster is already published, they get their personal link straight away.</DialogDescription>
        </DialogHeader>
        {error && <Alert tone="error">{error}</Alert>}
        {open && <ServingPeopleSearch scope={{ gatheringId, servingRoleId }} onPick={pick} disabled={pending} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Substitute ───────────────────────────────────────────────────────────────

interface Suggestion {
  personId: string;
  name: string;
  reasons: string[];
}

function SubstituteBody({ gatheringId, assignmentId, onDone }: { gatheringId: string; assignmentId: string; onDone: () => void }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    suggestServingSubstitutesAction({ assignmentId }).then((result) => {
      if (!cancelled) setSuggestions(result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const pick = (personId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await substituteServingAction({ assignmentId, personId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-2">
        <p className="text-sm font-medium">Suggested</p>
        {suggestions === null ? (
          <p className="text-sm text-muted">Finding people…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted">No one who plays this role is free then. Search below.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {suggestions.map((person) => (
              <li key={person.personId}>
                <button type="button" disabled={pending} onClick={() => pick(person.personId)} className={pickButtonClass}>
                  <span>
                    <span className="block font-medium">{person.name}</span>
                    <span className="block text-xs text-muted">{person.reasons.join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-brand-deep">Search everyone</summary>
        <div className="pt-3">
          <ServingPeopleSearch scope={{ gatheringId }} onPick={(person) => pick(person.personId)} disabled={pending} />
        </div>
      </details>
    </div>
  );
}

// ─── Share a personal link ────────────────────────────────────────────────────

function ShareLinkBody({ assignmentId }: { assignmentId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await shareServingLinkAction({ assignmentId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { firstName, gatheringName, dateLabel, timeLabel, roleName, url } = result.data;
      setMessage(`Hi ${firstName}! You’re on the roster for ${gatheringName} on ${dateLabel} at ${timeLabel} as ${roleName}. Please open your personal link to reply: ${url}`);
    });

  if (!message) {
    return (
      <div className="space-y-4">
        <p className="text-sm">The link lets them reply without signing in. It works only for this roster place, until the gathering ends.</p>
        {error && <Alert tone="error">{error}</Alert>}
        <DialogFooter>
          <Button onClick={create} disabled={pending}>
            {pending ? 'Creating…' : 'Create their link'}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <textarea readOnly rows={4} value={message} aria-label="Message with their link" className={cn(inputClassName, 'h-auto py-2')} />
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(message).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </Button>
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
          <Button onClick={() => void navigator.share({ text: message }).catch(() => undefined)}>Share…</Button>
        )}
      </DialogFooter>
    </div>
  );
}

// ─── Remove ───────────────────────────────────────────────────────────────────

function RemoveBody({ assignmentId, name, onDone }: { assignmentId: string; name: string; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const result = await removeServingAction({ assignmentId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });
  return (
    <div className="space-y-4">
      <p>{name} comes off this roster, and their link stops working. If they were already told, they get a short note.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <DialogFooter>
        <Button variant="danger" onClick={remove} disabled={pending}>
          {pending ? 'Removing…' : 'Remove from roster'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── The menu beside each person ──────────────────────────────────────────────

type MenuDialog = 'share' | 'substitute' | 'remove';

export function AssignmentMenu({
  gatheringId,
  assignment,
  roleName,
  published,
}: {
  gatheringId: string;
  assignment: { id: string; name: string; status: GatheringAssignmentStatus };
  roleName: string;
  published: boolean;
}) {
  const [dialog, setDialog] = useState<MenuDialog | null>(null);
  const titles: Record<MenuDialog, string> = {
    share: `Share ${assignment.name}’s link`,
    substitute: `Find a substitute for ${assignment.name}`,
    remove: `Remove ${assignment.name}?`,
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={`Actions for ${assignment.name}`}>
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {published && <DropdownMenuItem onSelect={() => setDialog('share')}>Share their link</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setDialog('substitute')}>Find a substitute</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('remove')}>
            Remove from roster
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog ? titles[dialog] : ''}</DialogTitle>
            <DialogDescription>{roleName}</DialogDescription>
          </DialogHeader>
          {dialog === 'share' && <ShareLinkBody assignmentId={assignment.id} />}
          {dialog === 'substitute' && <SubstituteBody gatheringId={gatheringId} assignmentId={assignment.id} onDone={() => setDialog(null)} />}
          {dialog === 'remove' && <RemoveBody assignmentId={assignment.id} name={assignment.name} onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Title and notes ──────────────────────────────────────────────────────────

const DetailsForm = z.object({
  title: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});

export function GatheringDetailsForm({ gatheringId, title, notes, typeName }: { gatheringId: string; title: string | null; notes: string | null; typeName: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: DetailsForm,
    defaultValues: { title: title ?? '', notes: notes ?? '' },
    action: (values) => updateGatheringAction({ gatheringId, ...values }),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <Field label="Title (optional)" placeholder={typeName} hint="For example “Dawn Worship: Missions week”." {...form.register('title')} errors={errorsFor('title')} />
      <div className="space-y-1.5">
        <label htmlFor="gathering-notes" className="block text-sm font-medium">
          Notes for the team <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="gathering-notes" rows={3} maxLength={2000} {...form.register('notes')} className={cn(inputClassName, 'h-auto py-2')} />
      </div>
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
