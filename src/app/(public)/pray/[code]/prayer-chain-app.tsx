'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { getChainPage } from '@/server/modules/prayer/participation.service';
import { callApi, publicInputClass, type ApiResult } from '../../_lib/public-api';
import { SlotCard } from '../../_prayer/slot-card';

/** Mirrors GET /api/public/prayer/chain. */
type ChainPageData = Awaited<ReturnType<typeof getChainPage>> & { formSession: string };
type OpenChain = Extract<ChainPageData, { status: 'ok' }>;

/** Counts a QR scan once per browser session. */
function firstScanThisSession(code: string): boolean {
  try {
    const key = `gt_scanned_${code}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

function fetchChainPage(code: string, scan: boolean) {
  const params = new URLSearchParams({ code });
  if (scan) params.set('scan', '1');
  return callApi<ChainPageData>('GET', `/api/public/prayer/chain?${params.toString()}`);
}

function prayingNow(now: NonNullable<OpenChain['now']>): string {
  const names = now.prayingFirstNames;
  if (names && names.length > 0) {
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    return `${list} ${names.length === 1 ? 'is' : 'are'} praying.`;
  }
  if (now.prayingCount === 0) return 'No one has checked in yet.';
  return now.prayingCount === 1 ? 'Someone is praying.' : `${now.prayingCount} people are praying.`;
}

export function PrayerChainApp({ code }: { code: string }) {
  const [page, setPage] = useState<ChainPageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((result: ApiResult<ChainPageData>) => {
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    setPage(result.data);
    setLoadError(null);
  }, []);

  const load = useCallback(async () => apply(await fetchChainPage(code, false)), [apply, code]);

  useEffect(() => {
    let cancelled = false;
    fetchChainPage(code, firstScanThisSession(code)).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, code]);

  const forget = async () => {
    await callApi('POST', '/api/public/forget', {});
    await load();
  };

  if (!page) {
    return loadError ? (
      <div className="space-y-4">
        <Alert tone="error" title="We couldn’t open the prayer chain">
          {loadError}
        </Alert>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-center gap-3 py-20 text-muted">
        <Loader2 aria-hidden className="size-5 animate-spin" /> Opening the prayer chain…
      </div>
    );
  }

  if (page.status !== 'ok') {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] leading-tight">Prayer Chain</h1>
        <Alert tone="warning" title={page.status === 'retired' ? 'This QR code is no longer in use' : 'We don’t recognise this QR code'}>
          Please ask your prayer coordinator for the current link.
        </Alert>
      </div>
    );
  }

  const { chain, now, coverageToday, participant } = page;
  const percent = coverageToday.total > 0 ? Math.round((coverageToday.covered / coverageToday.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-[28px] leading-tight">{chain.name}</h1>
        {chain.description && <p className="text-muted">{chain.description}</p>}
      </div>

      {chain.state === 'paused' && <Alert tone="info">This prayer chain is paused for now.</Alert>}
      {chain.state === 'ended' && (
        <Alert tone="success" title="This prayer chain has ended">
          Thank you to everyone who prayed.
        </Alert>
      )}

      {chain.state === 'active' && (
        <section aria-labelledby="now-praying" className="space-y-3 rounded-2xl border border-line bg-surface p-5">
          <h2 id="now-praying" className="text-lg">
            Now
          </h2>
          {now ? (
            <>
              <p className="font-display text-xl font-extrabold">{now.slotLabel}</p>
              <p>{prayingNow(now)}</p>
            </>
          ) : (
            <p className="text-muted">There is no prayer slot right now.</p>
          )}
          {coverageToday.total > 0 && (
            <div className="space-y-1.5">
              <p className="text-base text-muted">
                <span className="tabular">
                  {coverageToday.covered} of {coverageToday.total}
                </span>{' '}
                slots covered today
              </p>
              <div
                role="progressbar"
                aria-label="Slots covered today"
                aria-valuemin={0}
                aria-valuemax={coverageToday.total}
                aria-valuenow={coverageToday.covered}
                className="h-2.5 overflow-hidden rounded-full bg-ink/5"
              >
                <div className="h-full rounded-full bg-status-received" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
        </section>
      )}

      {participant ? (
        <section aria-labelledby="my-slots" className="space-y-4">
          <h2 id="my-slots" className="text-xl">
            Hello, {participant.firstName}!
          </h2>
          {participant.slots.length === 0 ? (
            <p className="text-muted">You don’t have an upcoming slot in this chain. Your coordinator can add you.</p>
          ) : (
            participant.slots.map((slot) => (
              <SlotCard key={slot.id} actor={{ assignmentId: slot.id }} initialSlot={slot} initialReport={null} formSession={page.formSession} />
            ))
          )}
          <p className="text-center text-base text-muted">
            Not {participant.firstName}?{' '}
            <button type="button" onClick={() => void forget()} className="font-medium text-brand-deep underline underline-offset-2">
              Use as someone else
            </button>
          </p>
        </section>
      ) : (
        chain.state !== 'ended' && <FindMySlot formSession={page.formSession} onFound={() => void load()} />
      )}
    </div>
  );
}

function FindMySlot({ formSession, onFound }: { formSession: string; onFound: () => void }) {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg">Are you praying in this chain?</h2>
        <p className="text-muted">Find your slot to confirm it or say when you’re praying.</p>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          Find my slot
        </Button>
      </section>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      const identify = () =>
        callApi<{ result: 'identified' | 'not_confirmed' | 'use_personal_link' }>('POST', '/api/public/identify', {
          phone: String(form.get('phone') ?? ''),
          firstName: String(form.get('firstName') ?? ''),
          rememberDevice: remember,
          formSession,
        });
      let result = await identify();
      if (!result.ok && result.error.meta?.reason === 'TOO_FAST') {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        result = await identify();
      }
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      if (result.data.result === 'identified') onFound();
      else if (result.data.result === 'use_personal_link') setMessage('Please use the personal link your coordinator sent you.');
      else setMessage('We couldn’t find you with that mobile number and first name. Please check both, or ask your coordinator.');
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg">Find my slot</h2>
      <label className="block space-y-1.5">
        <span className="font-medium">Mobile number</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" required className={publicInputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="font-medium">First name</span>
        <input name="firstName" autoComplete="given-name" required className={publicInputClass} />
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1 size-5 shrink-0 accent-brand-deep" />
        <span>
          Remember me on this phone
          <span className="block text-base text-muted">Untick this on a shared or borrowed phone.</span>
        </span>
      </label>
      {message && <Alert tone="warning">{message}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  );
}
