'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type {
  getChainPage,
  ParticipantSlot,
  PublicSlot,
} from '@/server/modules/prayer/participation.service';
import { callApi, publicInputClass, type ApiResult } from '../../_lib/public-api';
import { SlotCard } from '../../_prayer/slot-card';
import { SlotTile } from '../../_prayer/slot-tile';

/** Mirrors GET /api/public/prayer/chain. */
type ChainPageData = Awaited<ReturnType<typeof getChainPage>> & { formSession: string };
type OpenChain = Extract<ChainPageData, { status: 'ok' }>;

type Filter = 'all' | 'open' | 'mine';
type Screen =
  | { kind: 'browse' }
  /** An hour has been chosen and is waiting to be confirmed. */
  | { kind: 'confirm'; slot: PublicSlot }
  /** The same, but we don't know who is asking yet; no hour when they only want to find their own. */
  | { kind: 'identify'; slot: PublicSlot | null }
  /** They already hold an hour here, so they choose which one to keep. */
  | { kind: 'move'; slot: PublicSlot; current: ParticipantSlot };

type ClaimResponse =
  { result: 'claimed'; slot: ParticipantSlot } | { result: 'already_assigned'; current: ParticipantSlot };

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

function fetchChainPage(code: string, date: string | null, scan: boolean) {
  const params = new URLSearchParams({ code });
  if (date) params.set('date', date);
  if (scan) params.set('scan', '1');
  return callApi<ChainPageData>('GET', `/api/public/prayer/chain?${params.toString()}`);
}

/** "Tuesday, 22 September" from a YYYY-MM-DD chain date, with no time-zone shifting. */
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
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
  const [date, setDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [screen, setScreen] = useState<Screen>({ kind: 'browse' });
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = useCallback((result: ApiResult<ChainPageData>): boolean => {
    if (!result.ok) {
      // Nothing on screen yet, or something already on it: one of these two is read.
      setLoadError(result.error.message);
      setProblem(result.error.message);
      return false;
    }
    setPage(result.data);
    setLoadError(null);
    return true;
  }, []);

  const load = useCallback(
    async (on: string | null): Promise<boolean> => apply(await fetchChainPage(code, on, false)),
    [apply, code],
  );

  useEffect(() => {
    let cancelled = false;
    fetchChainPage(code, null, firstScanThisSession(code)).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, code]);

  const goTo = (on: string) => {
    setDate(on);
    setScreen({ kind: 'browse' });
    startTransition(async () => {
      await load(on);
    });
  };

  const forget = async () => {
    await callApi('POST', '/api/public/forget', {});
    await load(date);
  };

  /** Takes the hour, or comes back with the one they already hold. */
  const claim = (slot: PublicSlot, replaceAssignmentId?: string) => {
    startTransition(async () => {
      setProblem(null);
      const result = await callApi<ClaimResponse>('POST', '/api/public/prayer/claim', {
        code,
        slotId: slot.id,
        ...(replaceAssignmentId ? { replaceAssignmentId } : {}),
      });
      if (!result.ok) {
        setProblem(result.error.message);
        setScreen({ kind: 'browse' });
        await load(date);
        return;
      }
      if (result.data.result === 'already_assigned') {
        setScreen({ kind: 'move', slot, current: result.data.current });
        return;
      }
      setScreen({ kind: 'browse' });
      setNotice(`Thank you — ${slot.label} is yours. We'll remind you before it starts.`);
      await load(date);
    });
  };

  const choose = (slot: PublicSlot) => {
    setProblem(null);
    setNotice(null);
    setScreen(
      page?.status === 'ok' && page.participant ? { kind: 'confirm', slot } : { kind: 'identify', slot },
    );
  };

  if (!page) {
    return loadError ? (
      <div className="space-y-4">
        <Alert tone="error" title="We couldn’t open the prayer chain">
          {loadError}
        </Alert>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => void load(date)}>
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
        <Alert
          tone="warning"
          title={
            page.status === 'retired' ? 'This QR code is no longer in use' : 'We don’t recognise this QR code'
          }
        >
          Please ask your prayer coordinator for the current link.
        </Alert>
      </div>
    );
  }

  const { chain, now, participant, schedule } = page;
  const percent =
    schedule.summary.total > 0 ? Math.round((schedule.summary.covered / schedule.summary.total) * 100) : 0;

  // One hour at a time: choosing, or saying who you are, fills the screen.
  if (screen.kind !== 'browse') {
    return (
      <ChooseHour
        screen={screen}
        chainName={chain.name}
        dateLabel={dayLabel(schedule.date)}
        formSession={page.formSession}
        pending={pending}
        problem={problem}
        onBack={() => {
          setProblem(null);
          setScreen({ kind: 'browse' });
        }}
        onConfirm={(slot, replaceAssignmentId) => claim(slot, replaceAssignmentId)}
        onIdentified={async (slot) => {
          // If the refresh fails, the message is already on screen: stay put rather than show a stale day.
          if (!(await load(date))) return;
          // Straight to the hour they picked, or back to the day if they were only looking for their own.
          setScreen(slot ? { kind: 'confirm', slot } : { kind: 'browse' });
        }}
      />
    );
  }

  const shown = schedule.slots.filter((slot) =>
    filter === 'open' ? slot.claimable : filter === 'mine' ? slot.mine : true,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-[30px] leading-tight font-extrabold">{chain.name}</h1>
        <p className="text-muted">
          {chain.description ?? 'Choose an hour and commit to pray. Every hour matters.'}
        </p>
      </div>

      {chain.state === 'paused' && <Alert tone="info">This prayer chain is paused for now.</Alert>}
      {chain.state === 'ended' && (
        <Alert tone="success" title="This prayer chain has ended">
          Thank you to everyone who prayed.
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {problem && <Alert tone="warning">{problem}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* The panels come first on a phone: what is happening now, then the hours. */}
        <aside className="space-y-4 lg:order-2 lg:sticky lg:top-4 lg:self-start">
          {chain.state === 'active' && (
            <section
              aria-labelledby="now-praying"
              className="space-y-2 rounded-2xl border border-brand-deep/30 bg-brand-leaf-tint/40 p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id="now-praying" className="text-lg">
                  This hour
                </h2>
                <span className="rounded-full bg-brand-deep px-2.5 py-0.5 text-xs font-semibold text-white">
                  NOW
                </span>
              </div>
              {now ? (
                <>
                  <p className="font-display text-xl font-extrabold">{now.slotLabel}</p>
                  <p>{prayingNow(now)}</p>
                </>
              ) : (
                <p className="text-muted">There is no prayer hour right now.</p>
              )}
            </section>
          )}

          <section
            aria-labelledby="coverage"
            className="space-y-3 rounded-2xl border border-line bg-surface p-5"
          >
            <h2 id="coverage" className="text-lg">
              {schedule.date === schedule.today ? 'Today' : dayLabel(schedule.date)}
            </h2>
            <div className="flex items-baseline justify-between">
              <p className="tabular text-base text-muted">
                {schedule.summary.covered} of {schedule.summary.total} hours covered
              </p>
              <p className="tabular font-display text-lg font-extrabold">{percent}%</p>
            </div>
            <div
              role="progressbar"
              aria-label="Hours covered"
              aria-valuemin={0}
              aria-valuemax={schedule.summary.total}
              aria-valuenow={schedule.summary.covered}
              className="h-2.5 overflow-hidden rounded-full bg-ink/5"
            >
              <div className="h-full rounded-full bg-status-received" style={{ width: `${percent}%` }} />
            </div>
            <dl className="grid grid-cols-3 gap-2 pt-1 text-center">
              {[
                ['Open', schedule.summary.available],
                ['Prayed', schedule.summary.completed],
                ['Not filled', schedule.summary.unfilled],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-ground/70 py-2">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="tabular font-display text-xl font-extrabold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {participant ? (
            <section aria-labelledby="my-slots" className="space-y-4">
              <h2 id="my-slots" className="text-xl">
                Hello, {participant.firstName}!
              </h2>
              {participant.slots.length === 0 ? (
                <p className="text-muted">You don’t have an hour yet. Choose one that is still open.</p>
              ) : (
                participant.slots.map((slot) => (
                  <SlotCard
                    key={slot.id}
                    actor={{ assignmentId: slot.id }}
                    initialSlot={slot}
                    initialReport={null}
                    formSession={page.formSession}
                  />
                ))
              )}
              <p className="text-center text-base text-muted">
                Not {participant.firstName}?{' '}
                <button
                  type="button"
                  onClick={() => void forget()}
                  className="font-medium text-brand-deep underline underline-offset-2"
                >
                  Use as someone else
                </button>
              </p>
            </section>
          ) : (
            chain.state !== 'ended' && (
              <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-lg">Already praying in this chain?</h2>
                <p className="text-muted">Find your hour to confirm it or say when you’re praying.</p>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setScreen({ kind: 'identify', slot: null })}
                >
                  Find my hour
                </Button>
              </section>
            )
          )}
        </aside>

        <section aria-labelledby="schedule" className="space-y-4 lg:order-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="schedule" className="text-xl">
              The hours
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label="The day before"
                onClick={() => goTo(schedule.previousDate)}
                disabled={pending}
              >
                <ChevronLeft aria-hidden className="size-5" />
              </Button>
              <input
                type="date"
                value={schedule.date}
                max={schedule.nextDate}
                onChange={(event) => event.target.value && goTo(event.target.value)}
                aria-label="Day"
                className={cn(publicInputClass, 'w-auto py-2 text-base')}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="The next day"
                onClick={() => goTo(schedule.nextDate)}
                disabled={pending}
              >
                <ChevronRight aria-hidden className="size-5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Which hours to show">
            {(
              [
                ['all', `All hours (${schedule.slots.length})`],
                ['open', `Still open (${schedule.summary.available})`],
                ...(participant ? ([['mine', 'My hour']] as const) : []),
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-base transition-colors',
                  filter === value
                    ? 'border-brand-deep bg-brand-leaf-tint text-brand-deep'
                    : 'border-line bg-surface hover:border-brand-deep/40',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {!schedule.selfSignup && chain.state === 'active' && (
            <p className="text-base text-muted">
              Hours in this chain are arranged by the prayer coordinator.
            </p>
          )}

          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">
              {filter === 'open'
                ? 'Every hour of this day is covered. Thank you!'
                : 'There are no hours to show for this day.'}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((slot) => (
                <SlotTile
                  key={slot.id}
                  slot={slot}
                  busy={pending || !schedule.selfSignup}
                  onChoose={choose}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Choosing an hour ─────────────────────────────────────────────────────────

function ChooseHour({
  screen,
  chainName,
  dateLabel,
  formSession,
  pending,
  problem,
  onBack,
  onConfirm,
  onIdentified,
}: {
  screen: Exclude<Screen, { kind: 'browse' }>;
  chainName: string;
  dateLabel: string;
  formSession: string;
  pending: boolean;
  problem: string | null;
  onBack: () => void;
  onConfirm: (slot: PublicSlot, replaceAssignmentId?: string) => void;
  onIdentified: (slot: PublicSlot | null) => Promise<void>;
}) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-base font-medium text-brand-deep underline underline-offset-2"
      >
        ← Back to the hours
      </button>

      {screen.slot === null ? (
        <h1 className="font-display text-2xl font-extrabold leading-tight">Find my hour</h1>
      ) : (
        <section className="space-y-1 rounded-2xl border border-brand-deep/30 bg-brand-leaf-tint/40 p-5">
          <p className="text-base text-muted">{chainName}</p>
          <p className="font-display text-2xl font-extrabold leading-tight">{screen.slot.label}</p>
          <p className="text-muted">{dateLabel}</p>
        </section>
      )}

      {problem && <Alert tone="warning">{problem}</Alert>}

      {screen.kind === 'identify' && (
        <IdentifyForm formSession={formSession} onIdentified={() => void onIdentified(screen.slot)} />
      )}

      {screen.kind === 'confirm' && (
        <div className="space-y-4">
          <p>Taking this hour means you’ll pray at this time. We’ll remind you before it starts.</p>
          <Button size="lg" className="w-full" onClick={() => onConfirm(screen.slot)} disabled={pending}>
            {pending ? 'Just a moment…' : 'Confirm this hour'}
          </Button>
        </div>
      )}

      {screen.kind === 'move' && (
        <div className="space-y-4">
          <Alert tone="info" title="You already have an hour in this chain">
            {screen.current.slotLabel}
          </Alert>
          <p>Would you like to move to {screen.slot.label} instead?</p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => onConfirm(screen.slot, screen.current.id)}
            disabled={pending}
          >
            {pending ? 'Just a moment…' : 'Move to this hour'}
          </Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onBack} disabled={pending}>
            Keep {screen.current.slotLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function IdentifyForm({ formSession, onIdentified }: { formSession: string; onIdentified: () => void }) {
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      const identify = () =>
        callApi<{ result: 'identified' | 'not_confirmed' | 'use_personal_link' }>(
          'POST',
          '/api/public/identify',
          {
            phone: String(form.get('phone') ?? ''),
            firstName: String(form.get('firstName') ?? ''),
            rememberDevice: remember,
            formSession,
          },
        );
      let result = await identify();
      if (!result.ok && result.error.meta?.reason === 'TOO_FAST') {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        result = await identify();
      }
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      if (result.data.result === 'identified') onIdentified();
      else if (result.data.result === 'use_personal_link')
        setMessage('Please use the personal link your coordinator sent you.');
      else
        setMessage(
          'We couldn’t find you with that mobile number and first name. Please check both, or ask your coordinator.',
        );
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="space-y-1">
        <h2 className="text-lg">Who is praying?</h2>
        <p className="text-base text-muted">So we know whose hour this is, and can remind you.</p>
      </div>
      <label className="block space-y-1.5">
        <span className="font-medium">Mobile number</span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0917 123 4567"
          required
          className={publicInputClass}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="font-medium">First name</span>
        <input name="firstName" autoComplete="given-name" required className={publicInputClass} />
      </label>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-brand-deep"
        />
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
