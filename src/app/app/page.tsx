import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { formatLongDate, greeting } from '@/lib/dates';
import { countOpenFollowUps } from '@/server/modules/care/care.service';
import { getDevotionalOverview } from '@/server/modules/devotional/calendar.service';
import { getJournalOverview, listAwaitingReview } from '@/server/modules/journal/journal-portal.service';
import { listUnconfirmedRegistrations } from '@/server/modules/people/registrations.service';
import { listChains } from '@/server/modules/prayer/chains.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { canAccessChain, hasChainScope, hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ReplyCounts } from './devotional/reply-counts';

export const metadata: Metadata = { title: 'Dashboard' };

const plural = (n: number, word: string) => `${n.toLocaleString('en-PH')} ${word}${n === 1 ? '' : 's'}`;

export default async function DashboardPage() {
  const { ctx, user, sensitiveLocked } = await requirePortal();
  const db = getDb();
  const profile = await getSetting(db, 'ministry.profile');
  const firstName = user.name.split(' ')[0];
  const canManageUsers = hasPermission(ctx, 'iam.users.view') || sensitiveLocked;

  // Journal first: it also runs the day's ledger maintenance the other counts rely on.
  const journal = hasPermission(ctx, 'journal.status.view') ? await getJournalOverview(db, ctx, {}) : null;
  const [awaiting, followUps, registrations, chains, devotional] = await Promise.all([
    hasPermission(ctx, 'journal.review') ? listAwaitingReview(db, ctx, {}) : Promise.resolve(null),
    countOpenFollowUps(db, ctx),
    hasPermission(ctx, 'people.registrations.confirm') ? listUnconfirmedRegistrations(db, ctx, {}) : Promise.resolve(null),
    hasChainScope(ctx, 'prayer.view') ? listChains(db, ctx) : Promise.resolve(null),
    getDevotionalOverview(db, ctx),
  ]);

  // Prayer slots waiting for a coordinator, in the chains this user resolves.
  const resolvableChains = (chains ?? []).filter((chain) => canAccessChain(ctx, 'prayer.resolve', chain));
  const prayerFollowUps = resolvableChains.reduce((sum, chain) => sum + chain.coverage.followUps, 0);
  const chainsWithFollowUps = resolvableChains.filter((chain) => chain.coverage.followUps > 0);

  const attention = [
    awaiting && awaiting.total > 0 ? { href: '/app/journal/review', label: `${plural(awaiting.total, 'journal')} waiting for review` } : null,
    prayerFollowUps > 0
      ? {
          href: chainsWithFollowUps.length === 1 ? `/app/prayer/${chainsWithFollowUps[0]!.id}` : '/app/prayer',
          label: `${plural(prayerFollowUps, 'prayer slot')} to follow up`,
        }
      : null,
    ...(devotional?.attention ?? []),
    followUps.mine > 0
      ? { href: '/app/follow-ups?assigned=me', label: `${plural(followUps.mine, 'follow-up')} with you` }
      : followUps.open > 0
        ? { href: '/app/follow-ups', label: `${plural(followUps.open, 'open follow-up')}` }
        : null,
    registrations && registrations.total > 0
      ? { href: '/app/people/registrations', label: `${plural(registrations.total, 'new registration')} to confirm` }
      : null,
  ].filter((item): item is { href: string; label: string } => item !== null);
  const showAttention =
    hasPermission(ctx, 'journal.review') ||
    hasPermission(ctx, 'care.view') ||
    registrations !== null ||
    resolvableChains.length > 0 ||
    hasPermission(ctx, 'devotional.manage');

  const checklist = [
    { label: 'Turn on two-step verification', done: user.twoFactorEnabled, href: '/app/account/security' },
    // Importing is a sensitive permission: until it's usable (two-step verification), the page would be a 404.
    { label: 'Import your people and leadership structure', done: false, href: hasPermission(ctx, 'import.manage') ? '/app/people/import' : undefined },
    { label: 'Invite your pastors and ministry office', done: false, href: '/app/admin/users' },
    hasGlobal(ctx, 'links.manage')
      ? { label: 'Print journal QR codes for your leaders', done: false, href: '/app/admin/qr', note: 'A branch’s cards print together, four to an A4 page.' }
      : { label: 'Print journal QR codes for your leaders', done: false, note: 'Open a leader’s profile and choose “journal QR code”.' },
  ];

  const s = journal?.summary;
  const percent = s && s.expected > 0 ? Math.round((s.received / s.expected) * 100) : 0;

  const journalSection = journal && s && (
    <section aria-labelledby="journal-today" className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="journal-today" className="text-lg">
          Daily Journal today
        </h2>
        <Link href="/app/journal" className="text-sm font-medium text-brand-deep hover:underline">
          Open
        </Link>
      </div>
      <p className="text-muted">
        {journal.leader?.isSelf ? 'Your group' : 'The people you care for'}:{' '}
        <strong className="tabular text-ink">
          {s.received.toLocaleString('en-PH')} of {s.expected.toLocaleString('en-PH')}
        </strong>{' '}
        received
        {s.late > 0 ? ` · ${s.late} late` : ''}
        {s.notYet > 0 ? ` · ${s.notYet} not yet` : ''}
      </p>
      <div
        role="progressbar"
        aria-label="Journals received today"
        aria-valuemin={0}
        aria-valuemax={s.expected}
        aria-valuenow={s.received}
        className="h-2.5 overflow-hidden rounded-full bg-ink/5"
      >
        <div className="h-full rounded-full bg-status-received" style={{ width: `${percent}%` }} />
      </div>
      {journal.groups.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {journal.groups.slice(0, 6).map((g) => (
            <li key={g.leaderId} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/app/journal?leaderId=${g.leaderId}&view=branch`} className="hover:text-brand-deep hover:underline">
                {g.leaderName}’s branch
              </Link>
              <span className="tabular text-muted">
                {g.received} of {g.expected}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const runningChains = (chains ?? []).filter((chain) => chain.status === 'active');
  const prayerSection = chains && (
    <section aria-labelledby="prayer-today" className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="prayer-today" className="text-lg">
          Prayer Chain today
        </h2>
        <Link href="/app/prayer" className="text-sm font-medium text-brand-deep hover:underline">
          Open
        </Link>
      </div>
      {runningChains.length === 0 ? (
        <p className="text-muted">No prayer chain is running right now.</p>
      ) : (
        <ul className="space-y-4">
          {runningChains.slice(0, 5).map((chain) => {
            const covered = chain.coverage.total > 0 ? Math.round((chain.coverage.covered / chain.coverage.total) * 100) : 0;
            return (
              <li key={chain.id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/app/prayer/${chain.id}`} className="font-medium hover:text-brand-deep hover:underline">
                    {chain.name}
                  </Link>
                  <span className="tabular text-sm text-muted">
                    {chain.coverage.total === 0 ? 'No slots today' : `${chain.coverage.covered} of ${chain.coverage.total} slots covered`}
                  </span>
                </div>
                {chain.coverage.total > 0 && (
                  <div
                    role="progressbar"
                    aria-label={`${chain.name}: slots covered today`}
                    aria-valuemin={0}
                    aria-valuemax={chain.coverage.total}
                    aria-valuenow={chain.coverage.covered}
                    className="h-2 overflow-hidden rounded-full bg-ink/5"
                  >
                    <div className="h-full rounded-full bg-status-received" style={{ width: `${covered}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  // FR-DEV-09: the next few gatherings with their replies (5 ✓ · 1 ◷ · 0 ✗).
  const devotionalSection = devotional && (
    <section aria-labelledby="devotional-soon" className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="devotional-soon" className="text-lg">
          Devotional
        </h2>
        <Link href="/app/devotional" className="text-sm font-medium text-brand-deep hover:underline">
          Open
        </Link>
      </div>
      {devotional.upcoming.length === 0 ? (
        <p className="text-muted">No gatherings in the next three days.</p>
      ) : (
        <ul className="divide-y divide-line">
          {devotional.upcoming.map((gathering) => (
            <li key={gathering.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div>
                <Link href={`/app/devotional/${gathering.id}`} className="font-medium hover:text-brand-deep hover:underline">
                  {gathering.name}
                </Link>
                <p className="text-sm text-muted">
                  {gathering.dateLabel} · {gathering.timeLabel}
                  {gathering.teamName ? ` · ${gathering.teamName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ReplyCounts confirmed={gathering.confirmed} pending={gathering.pending} declined={gathering.declined} />
                {gathering.openRequired > 0 && <Badge tone="amber">{gathering.openRequired === 1 ? '1 role open' : `${gathering.openRequired} roles open`}</Badge>}
                {!gathering.published && <Badge>Draft</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  // The first ministry card this person has takes the wide spot next to "Needs your attention"; the rest follow below.
  const secondaryPrayer = journalSection ? prayerSection : null;
  const secondaryDevotional = journalSection || prayerSection ? devotionalSection : null;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-muted">{formatLongDate(ctx.now, profile.timezone)}</p>
        <h1 className="text-3xl">
          {greeting(ctx.now, profile.timezone)}, {firstName}
        </h1>
      </header>

      {sensitiveLocked && (
        <Alert tone="warning" title="Some of your access is waiting for two-step verification">
          Your role includes sensitive areas (such as journal answers, user management and settings). They unlock once you{' '}
          <Link href="/app/account/security" className="font-semibold underline">
            turn on two-step verification
          </Link>
          .
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {journalSection ||
          prayerSection ||
          devotionalSection || (
            <section className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center">
              <p className="font-display text-lg font-bold">Ministry Today</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Daily Journal, Prayer Chain and Morning Devotional appear here for leaders and pastors.
              </p>
            </section>
          )}

        {showAttention && (
          <section aria-labelledby="attention" className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <h2 id="attention" className="text-lg">
              Needs your attention
            </h2>
            {attention.length === 0 ? (
              <p className="mt-2 text-muted">Nothing is waiting for you right now.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {attention.map((item) => (
                  <li key={`${item.href} ${item.label}`}>
                    <Link href={item.href} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-deep">
                      <span>{item.label}</span>
                      <ChevronRight aria-hidden className="size-4 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {(secondaryPrayer || secondaryDevotional) && (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          {secondaryPrayer}
          {secondaryDevotional}
        </div>
      )}

      {canManageUsers && (
        <section aria-labelledby="setup" className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 id="setup" className="text-lg">
            Getting {profile.shortName} ready
          </h2>
          <ul className="mt-4 space-y-3">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-start gap-3">
                {item.done ? (
                  <CheckCircle2 aria-label="Done" className="mt-0.5 size-5 text-brand-deep" />
                ) : (
                  <Circle aria-label="Not done yet" className="mt-0.5 size-5 text-status-notyet" />
                )}
                <div>
                  {item.href && !item.done ? (
                    <Link href={item.href} className="font-medium text-brand-deep underline-offset-2 hover:underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span className={item.done ? 'text-muted line-through' : 'font-medium'}>{item.label}</span>
                  )}
                  {item.note && <p className="text-sm text-muted">{item.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
