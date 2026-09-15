import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { formatLongDate, greeting } from '@/lib/dates';
import { countOpenFollowUps } from '@/server/modules/care/care.service';
import { getJournalOverview, listAwaitingReview } from '@/server/modules/journal/journal-portal.service';
import { listUnconfirmedRegistrations } from '@/server/modules/people/registrations.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

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
  const [awaiting, followUps, registrations] = await Promise.all([
    hasPermission(ctx, 'journal.review') ? listAwaitingReview(db, ctx, {}) : Promise.resolve(null),
    countOpenFollowUps(db, ctx),
    hasPermission(ctx, 'people.registrations.confirm') ? listUnconfirmedRegistrations(db, ctx, {}) : Promise.resolve(null),
  ]);

  const attention = [
    awaiting && awaiting.total > 0 ? { href: '/app/journal/review', label: `${plural(awaiting.total, 'journal')} waiting for review` } : null,
    followUps.mine > 0
      ? { href: '/app/follow-ups?assigned=me', label: `${plural(followUps.mine, 'follow-up')} with you` }
      : followUps.open > 0
        ? { href: '/app/follow-ups', label: `${plural(followUps.open, 'open follow-up')}` }
        : null,
    registrations && registrations.total > 0
      ? { href: '/app/people/registrations', label: `${plural(registrations.total, 'new registration')} to confirm` }
      : null,
  ].filter((item): item is { href: string; label: string } => item !== null);
  const showAttention = hasPermission(ctx, 'journal.review') || hasPermission(ctx, 'care.view') || registrations !== null;

  const checklist = [
    { label: 'Turn on two-step verification', done: user.twoFactorEnabled, href: '/app/account/security' },
    { label: 'Import your people and leadership structure', done: false, href: '/app/people/import' },
    { label: 'Invite your pastors and ministry office', done: false, href: '/app/admin/users' },
    { label: 'Print journal QR codes for your leaders', done: false, note: 'Open a leader’s profile and choose “journal QR code”.' },
  ];

  const s = journal?.summary;
  const percent = s && s.expected > 0 ? Math.round((s.received / s.expected) * 100) : 0;

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
        {journal && s ? (
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
        ) : (
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
                  <li key={item.href}>
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
