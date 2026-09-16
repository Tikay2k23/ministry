'use client';

import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { PrayerAssignmentStatus } from '@/server/db/enums';
import type { AnswerValue } from '@/server/modules/forms/answers';
import {
  assignAction,
  cancelAssignmentAction,
  resolveFollowUpAction,
  shareLinkAction,
  substituteAction,
  suggestSubstitutesAction,
  viewReportAction,
} from '../actions';
import { PeopleSearch, pickButtonClass, type PersonOption } from '../people-search';

/** The chain board's actions (docs/04 A17): assign, substitute, remove, resolve, share a link and read a report. */

// ─── Assign ───────────────────────────────────────────────────────────────────

export function AssignButton({ chainId, slotId, slotLabel }: { chainId: string; slotId: string; slotLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = (person: PersonOption) =>
    startTransition(async () => {
      setError(null);
      const result = await assignAction({ slotId, personId: person.personId });
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
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden className="size-4" /> Assign
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign someone</DialogTitle>
          <DialogDescription>{slotLabel}. If they have an email address, they’ll receive their personal link.</DialogDescription>
        </DialogHeader>
        {error && <Alert tone="error">{error}</Alert>}
        {open && <PeopleSearch chainId={chainId} onPick={pick} disabled={pending} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Substitute ───────────────────────────────────────────────────────────────

function SubstituteBody({ chainId, assignmentId, onDone }: { chainId: string; assignmentId: string; onDone: () => void }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<PersonOption[] | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    suggestSubstitutesAction({ assignmentId }).then((result) => {
      if (!cancelled) setSuggestions(result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const pick = (person: PersonOption) =>
    startTransition(async () => {
      setError(null);
      const result = await substituteAction({ assignmentId, substitutePersonId: person.personId, reason });
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
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Reason <span className="font-normal text-muted">(optional)</span>
        </span>
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputClassName} />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Free at that time</p>
        {suggestions === null ? (
          <p className="text-sm text-muted">Finding people…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted">No one from this chain is free then. Search below.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {suggestions.map((person) => (
              <li key={person.personId}>
                <button type="button" disabled={pending} onClick={() => pick(person)} className={pickButtonClass}>
                  <span className="font-medium">{person.name}</span>
                  <span className="text-xs text-muted">
                    {person.recentSlots ? `${person.recentSlots} slot${person.recentSlots === 1 ? '' : 's'} in the last month` : 'No slots in the last month'}
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
          <PeopleSearch chainId={chainId} onPick={pick} disabled={pending} />
        </div>
      </details>
    </div>
  );
}

function SubstituteDialog({
  open,
  onOpenChange,
  chainId,
  assignmentId,
  personName,
  slotLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chainId: string;
  assignmentId: string;
  personName: string;
  slotLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Find a substitute for {personName}</DialogTitle>
          <DialogDescription>{slotLabel}</DialogDescription>
        </DialogHeader>
        {open && <SubstituteBody chainId={chainId} assignmentId={assignmentId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function SubstituteButton(props: { chainId: string; assignmentId: string; personName: string; slotLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Find a substitute
      </Button>
      <SubstituteDialog open={open} onOpenChange={setOpen} {...props} />
    </>
  );
}

// ─── Resolve a follow-up ──────────────────────────────────────────────────────

const ResolveForm = z.object({
  outcome: z.enum(['completed_verified', 'excused', 'missed']),
  note: z.string().trim().max(1000),
});

const OUTCOMES = [
  { value: 'completed_verified', label: 'They prayed', hint: 'They just forgot to tap “I’ve finished praying”.' },
  { value: 'excused', label: 'Excused', hint: 'An emergency, illness or something similar.' },
  { value: 'missed', label: 'Missed', hint: 'The slot wasn’t covered.' },
] as const;

function ResolveBody({ assignmentId, personName, onDone }: { assignmentId: string; personName: string; onDone: () => void }) {
  const router = useRouter();
  const { form, submit, pending, formError } = useActionForm({
    schema: ResolveForm,
    defaultValues: { outcome: 'completed_verified', note: '' },
    action: (values) => resolveFollowUpAction({ assignmentId, ...values }),
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">After checking in with {personName}</legend>
        {OUTCOMES.map((outcome) => (
          <label key={outcome.value} className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="radio" value={outcome.value} {...form.register('outcome')} className="mt-1 size-4 accent-brand-deep" />
            <span>
              <span className="block font-medium">{outcome.label}</span>
              <span className="block text-sm text-muted">{outcome.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Note <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea rows={3} maxLength={1000} {...form.register('note')} className={cn(inputClassName, 'h-auto py-2')} />
      </label>
      {formError && <Alert tone="error">{formError}</Alert>}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ResolveButton({ assignmentId, personName, slotLabel }: { assignmentId: string; personName: string; slotLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow up with {personName}</DialogTitle>
          <DialogDescription>{slotLabel}. Only you decide how this slot is recorded.</DialogDescription>
        </DialogHeader>
        {open && <ResolveBody assignmentId={assignmentId} personName={personName} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
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
      const result = await shareLinkAction({ assignmentId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { firstName, chainName, slotLabel, url } = result.data;
      setMessage(`Hi ${firstName}! Your prayer slot in ${chainName} is ${slotLabel}. Please open your personal link to confirm it: ${url}`);
    });

  if (!message) {
    return (
      <div className="space-y-4">
        <p className="text-sm">The link lets them confirm, check in and finish without signing in. It works only for this slot.</p>
        {error && <Alert tone="error">{error}</Alert>}
        <DialogFooter>
          <Button onClick={create} disabled={pending}>
            {pending ? 'Creating…' : 'Create their link'}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const share = async () => {
    if (typeof navigator.share === 'function') await navigator.share({ text: message }).catch(() => undefined);
  };

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
        <Button onClick={() => void share()}>Share…</Button>
      </DialogFooter>
    </div>
  );
}

// ─── Read a report ────────────────────────────────────────────────────────────

type Report = Extract<Awaited<ReturnType<typeof viewReportAction>>, { ok: true }>['data'];

const answerText = (value: AnswerValue) => (value.t === 'text' ? value.v : value.t === 'bool' ? (value.v ? 'Yes' : 'No') : JSON.stringify(value.v));

function ReportBody({ assignmentId }: { assignmentId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opening a report is recorded in the access log: fetch it once, even when React runs effects twice in development.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    viewReportAction({ assignmentId }).then((result) => {
      if (result.ok) setReport(result.data);
      else setError(result.error.message);
    });
  }, [assignmentId]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!report) return <p className="text-sm text-muted">Opening the report…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {report.anonymous ? 'Shared anonymously' : `From ${report.personName}`} · {report.slotLabel}
      </p>
      {report.answers.map((answer) => (
        <div key={answer.label} className="space-y-1">
          <p className="text-sm font-medium">{answer.label}</p>
          <p className="whitespace-pre-line">{answerText(answer.value)}</p>
        </div>
      ))}
      {report.privateAnswers > 0 && (
        <p className="text-sm text-muted">
          {report.privateAnswers === 1 ? 'One more answer was' : `${report.privateAnswers} more answers were`} shared only with the pastoral team.
        </p>
      )}
    </div>
  );
}

// ─── Remove from a slot ───────────────────────────────────────────────────────

function RemoveBody({ assignmentId, personName, onDone }: { assignmentId: string; personName: string; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const result = await cancelAssignmentAction({ assignmentId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });
  return (
    <div className="space-y-4">
      <p>{personName} will no longer be on this slot, and their personal link will stop working.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <DialogFooter>
        <Button variant="danger" onClick={remove} disabled={pending}>
          {pending ? 'Removing…' : 'Remove from slot'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── The menu beside each person ──────────────────────────────────────────────

type MenuDialog = 'share' | 'substitute' | 'report' | 'remove';

export function AssignmentMenu({
  chainId,
  assignment,
  slotLabel,
  slotStarted,
  canAssign,
}: {
  chainId: string;
  assignment: { id: string; name: string; status: PrayerAssignmentStatus; hasReport: boolean };
  slotLabel: string;
  slotStarted: boolean;
  canAssign: boolean;
}) {
  const [dialog, setDialog] = useState<MenuDialog | null>(null);
  const active = ['scheduled', 'confirmed', 'in_prayer', 'needs_follow_up'].includes(assignment.status);
  const upcoming = (assignment.status === 'scheduled' || assignment.status === 'confirmed') && !slotStarted;
  if (!(canAssign && active) && !assignment.hasReport) return null;

  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const titles: Record<MenuDialog, string> = {
    share: `Share ${assignment.name}’s link`,
    substitute: `Find a substitute for ${assignment.name}`,
    report: 'Prayer report',
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
          {canAssign && active && <DropdownMenuItem onSelect={() => setDialog('share')}>Share their link</DropdownMenuItem>}
          {canAssign && active && <DropdownMenuItem onSelect={() => setDialog('substitute')}>Find a substitute</DropdownMenuItem>}
          {assignment.hasReport && <DropdownMenuItem onSelect={() => setDialog('report')}>Read their report</DropdownMenuItem>}
          {canAssign && upcoming && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog('remove')}>
                Remove from this slot
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SubstituteDialog
        open={dialog === 'substitute'}
        onOpenChange={close}
        chainId={chainId}
        assignmentId={assignment.id}
        personName={assignment.name}
        slotLabel={slotLabel}
      />
      <Dialog open={dialog === 'share' || dialog === 'report' || dialog === 'remove'} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog && dialog !== 'substitute' ? titles[dialog] : ''}</DialogTitle>
            <DialogDescription>{slotLabel}</DialogDescription>
          </DialogHeader>
          {dialog === 'share' && <ShareLinkBody assignmentId={assignment.id} />}
          {dialog === 'report' && <ReportBody assignmentId={assignment.id} />}
          {dialog === 'remove' && <RemoveBody assignmentId={assignment.id} personName={assignment.name} onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
