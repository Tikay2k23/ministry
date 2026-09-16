'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ServingView } from '@/server/modules/devotional/participation.service';
import { callApi, publicTextareaClass } from '../_lib/public-api';

const STATE_TEXT: Record<ServingView['state'], string> = {
  pending: 'Please let us know if you can serve.',
  confirmed: 'You’re serving — thank you!',
  declined: 'You told your coordinator you can’t serve this time.',
};

/** One serving role, with "I'll be there" and "I can't make it" (docs/04 P8). */
export function ServingCard({ token, initialView }: { token: string; initialView: ServingView }) {
  const [view, setView] = useState(initialView);
  const [askingWhy, setAskingWhy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const respond = (response: 'accept' | 'decline') =>
    startTransition(async () => {
      setError(null);
      const result = await callApi<{ view: ServingView }>('POST', '/api/public/serving/respond', {
        token,
        response,
        ...(response === 'decline' ? { note } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setView(result.data.view);
      setAskingWhy(false);
      setThanks(
        response === 'accept'
          ? 'Thank you! Your coordinator can see you’re serving.'
          : 'Thank you for letting us know. Your coordinator will find someone to serve in your place.',
      );
    });

  const sendDecline = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    respond('decline');
  };

  return (
    <article className="space-y-5 rounded-2xl border border-line bg-surface p-5">
      <div className="space-y-1">
        <p className="text-base text-muted">{view.gatheringName}</p>
        <p className="font-display text-xl leading-snug font-extrabold">{view.dateLabel}</p>
        <p className="text-base">{view.timeLabel}</p>
      </div>

      <div className="rounded-xl bg-ground p-4">
        <p className="text-sm text-muted">Your role</p>
        <p className="text-lg font-semibold">{view.roleName}</p>
        {view.teamName && <p className="text-base text-muted">{view.teamName}</p>}
      </div>

      <div className="space-y-1">
        <p className={view.state === 'confirmed' ? 'flex items-center gap-2 font-medium text-brand-deep' : 'font-medium'}>
          {view.state === 'confirmed' && <CheckCircle2 aria-hidden className="size-5" />}
          {STATE_TEXT[view.state]}
        </p>
        {view.state === 'declined' && view.responseNote && <p className="text-base text-muted">“{view.responseNote}”</p>}
      </div>

      {thanks && <Alert tone="success">{thanks}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {view.lockedMessage && <Alert tone="info">{view.lockedMessage}</Alert>}

      {view.canRespond && !askingWhy && (
        <div className="space-y-2">
          {view.state !== 'confirmed' && (
            <Button size="lg" className="w-full" disabled={pending} onClick={() => respond('accept')}>
              {pending ? (
                <>
                  <Loader2 aria-hidden className="size-5 animate-spin" /> Saving…
                </>
              ) : (
                'I’ll be there'
              )}
            </Button>
          )}
          {view.state !== 'declined' && (
            <Button size="lg" variant={view.state === 'confirmed' ? 'secondary' : 'ghost'} className="w-full" disabled={pending} onClick={() => setAskingWhy(true)}>
              I can’t make it
            </Button>
          )}
        </div>
      )}

      {askingWhy && (
        <form onSubmit={sendDecline} className="space-y-4 rounded-xl bg-ground p-4">
          <label className="block space-y-1.5">
            <span className="font-medium">
              Anything your coordinator should know? <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={publicTextareaClass} />
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

      {view.roster.length > 0 && (
        <section aria-labelledby="whos-serving" className="space-y-2">
          <h2 id="whos-serving" className="text-lg">
            Who’s serving
          </h2>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {view.roster.map((role) => (
              <div key={role.roleName} className="flex justify-between gap-3 px-4 py-2.5 text-base">
                <dt className="text-muted">{role.roleName}</dt>
                <dd className="text-right font-medium">{role.names.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}
