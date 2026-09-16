'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CANNOT_MAKE_IT_LABELS, CANNOT_MAKE_IT_REASONS, type CannotMakeItReason } from '@/server/modules/prayer/participant-options';
import type { ParticipantSlot, ReportForm } from '@/server/modules/prayer/participation.service';
import { callApi, publicTextareaClass } from '../_lib/public-api';
import { PrayerReportForm } from './report-form';

/** How the page acts on the slot: with the personal link it was opened with, or as the person remembered on this phone. */
export type SlotActor = { token: string } | { assignmentId: string };

type Action = 'confirm' | 'check_in' | 'complete' | 'cannot_make_it';

const PRIMARY_LABEL: Record<NonNullable<ParticipantSlot['primaryAction']>, string> = {
  confirm: 'Confirm my slot',
  check_in: 'I’m praying now',
  complete: 'I’ve finished praying',
};

const STATE_TEXT: Record<ParticipantSlot['state'], string> = {
  upcoming: 'Upcoming',
  confirmed: 'Confirmed — thank you!',
  praying: 'Praying now',
  completed: 'Finished — thank you for praying!',
  needs_follow_up: 'We didn’t hear back after this slot',
  resolved: 'Your coordinator has updated this slot',
  reassigned: 'This slot has been reassigned — thank you!',
};

/** One prayer slot with the one action that fits this moment (docs/04 P6–P7). */
export function SlotCard({
  actor,
  initialSlot,
  initialReport,
  formSession,
}: {
  actor: SlotActor;
  initialSlot: ParticipantSlot;
  initialReport: ReportForm | null;
  formSession: string;
}) {
  const [slot, setSlot] = useState(initialSlot);
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [askingWhy, setAskingWhy] = useState(false);
  const [reason, setReason] = useState<CannotMakeItReason>('unwell');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  const act = (action: Action) =>
    startTransition(async () => {
      setError(null);
      const result = await callApi<{ slot: ParticipantSlot; report: ReportForm | null }>('POST', '/api/public/prayer/respond', {
        ...actor,
        action,
        ...(action === 'cannot_make_it' ? { reason, note } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSlot(result.data.slot);
      setReport(result.data.report);
      if (action === 'cannot_make_it') {
        setAskingWhy(false);
        setThanks('Thank you for letting us know. Your coordinator will arrange someone to cover this slot.');
      }
    });

  const sendCannotMakeIt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    act('cannot_make_it');
  };

  const done = slot.state === 'completed' || slot.state === 'confirmed';

  return (
    <article className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="space-y-1">
        <p className="text-base text-muted">{slot.chainName}</p>
        <p className="font-display text-xl leading-snug font-extrabold">{slot.slotLabel}</p>
        <p className={done ? 'flex items-center gap-2 font-medium text-brand-deep' : 'font-medium'}>
          {done && <CheckCircle2 aria-hidden className="size-5" />}
          {STATE_TEXT[slot.state]}
        </p>
        {slot.completedLate && <p className="text-base text-muted">Marked finished after the slot — that’s okay.</p>}
      </div>

      {slot.state === 'needs_follow_up' && slot.primaryAction === 'complete' && (
        <p>If you prayed, please tap “I’ve finished praying”. It helps your coordinator.</p>
      )}
      {slot.cannotMakeIt && !thanks && slot.state !== 'reassigned' && (
        <Alert tone="info">You told your coordinator you can’t make it. They will arrange someone to cover this slot.</Alert>
      )}
      {thanks && <Alert tone="success">{thanks}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {slot.primaryAction && (
        <Button size="lg" className="w-full" disabled={pending} onClick={() => act(slot.primaryAction!)}>
          {pending ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin" /> Saving…
            </>
          ) : (
            PRIMARY_LABEL[slot.primaryAction]
          )}
        </Button>
      )}
      {slot.hint && <p className="text-base text-muted">{slot.hint}</p>}

      {slot.canSayCannotMakeIt && !askingWhy && (
        <button type="button" onClick={() => setAskingWhy(true)} className="text-base font-medium text-brand-deep underline underline-offset-2">
          I can’t make it
        </button>
      )}
      {askingWhy && (
        <form onSubmit={sendCannotMakeIt} className="space-y-4 rounded-xl bg-ground p-4">
          <fieldset className="space-y-1">
            <legend className="mb-1 font-semibold">What’s happening?</legend>
            {CANNOT_MAKE_IT_REASONS.map((key) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} className="size-5 accent-brand-deep" />
                {CANNOT_MAKE_IT_LABELS[key]}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1.5">
            <span className="font-medium">
              Anything your coordinator should know? <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={publicTextareaClass} />
          </label>
          <div className="space-y-2">
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              Let my coordinator know
            </Button>
            <Button size="lg" variant="ghost" className="w-full" onClick={() => setAskingWhy(false)}>
              Never mind
            </Button>
          </div>
        </form>
      )}

      {slot.canReport && report && (
        <PrayerReportForm actor={actor} form={report} formSession={formSession} onSent={() => setSlot({ ...slot, canReport: false })} />
      )}
    </article>
  );
}
