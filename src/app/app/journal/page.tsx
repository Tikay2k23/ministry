import { Camera, ClipboardCheck, NotebookPen, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DayDots, EXCUSE_LABEL, formatClock, formatDayLabel, JournalStatus } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref, Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';
import { isAppError } from '@/server/errors';
import { getJournalOverview, listAwaitingReview, type JournalStatusFilter } from '@/server/modules/journal/journal-portal.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'Daily Journal' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_OPTIONS: { value: JournalStatusFilter; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'not_yet', label: 'Not yet' },
  { value: 'received', label: 'Received' },
  { value: 'late', label: 'Received late' },
  { value: 'missed', label: 'No journal' },
  { value: 'excused', label: 'Excused' },
  { value: 'awaiting_review', label: 'Awaiting review' },
];

export default async function JournalTodayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'journal.status.view')) notFound();
  const db = getDb();
  const sp = await searchParams;
  const input = { date: first(sp.date), leaderId: first(sp.leaderId), view: first(sp.view), status: first(sp.status), page: first(sp.page) };

  let overview;
  try {
    overview = await getJournalOverview(db, ctx, input);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const canReview = hasPermission(ctx, 'journal.review');
  const [{ timezone }, awaiting] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    canReview ? listAwaitingReview(db, ctx, {}) : Promise.resolve(null),
  ]);

  const isToday = overview.date === overview.today;
  const baseParams = {
    date: isToday ? undefined : overview.date,
    leaderId: input.leaderId,
    view: overview.view === 'direct' ? undefined : overview.view,
  };
  const s = overview.summary;
  const tiles: { label: string; value: number; note?: string; status: JournalStatusFilter }[] = [
    { label: 'Received', value: s.received, note: s.late ? `${s.late} late` : undefined, status: 'received' },
    { label: isToday ? 'Not yet' : 'Still open', value: s.notYet, status: 'not_yet' },
    { label: 'No journal', value: s.missed, status: 'missed' },
    { label: 'Excused', value: s.excused, status: 'excused' },
    ...(canReview ? [{ label: 'Awaiting review', value: s.awaitingReview, status: 'awaiting_review' as const }] : []),
  ];
  const scopeLabel = overview.leader
    ? overview.view === 'branch'
      ? `${overview.leader.isSelf ? 'Your' : `${overview.leader.name}’s`} whole branch`
      : `${overview.leader.isSelf ? 'Your' : `${overview.leader.name}’s`} group`
    : 'Everyone you can see';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Journal"
        description={
          <>
            {formatDayLabel(overview.date)} · {scopeLabel} ·{' '}
            <span className="tabular">
              {s.received} of {s.expected} received
            </span>
          </>
        }
        actions={
          <>
            {canReview && awaiting && (
              <Button asChild variant="secondary">
                <Link href="/app/journal/review">
                  <ClipboardCheck aria-hidden className="size-4" /> Awaiting review
                  <span className="tabular rounded-full bg-ink/10 px-2 text-xs">{awaiting.total}</span>
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href="/app/journal/calendar">Rest days</Link>
            </Button>
            {(hasGlobal(ctx, 'forms.manage') || hasGlobal(ctx, 'forms.publish')) && (
              <Button asChild variant="ghost">
                <Link href="/app/journal/form">Questions</Link>
              </Button>
            )}
          </>
        }
      />

      <form method="get" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        {input.leaderId && <input type="hidden" name="leaderId" value={input.leaderId} />}
        <div className="space-y-1">
          <label htmlFor="date" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Day
          </label>
          <input id="date" name="date" type="date" max={overview.today} defaultValue={overview.date} className={inputClassName} />
        </div>
        {(overview.leader || input.view === 'all') && (
          <div className="space-y-1">
            <label htmlFor="view" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Show
            </label>
            <select id="view" name="view" defaultValue={overview.view} className={inputClassName}>
              <option value="direct">Direct group</option>
              <option value="branch">Whole branch</option>
              <option value="all">Everyone I can see</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="status" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Status
          </label>
          <select id="status" name="status" defaultValue={overview.status} className={inputClassName}>
            {STATUS_OPTIONS.filter((o) => canReview || o.value !== 'awaiting_review').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Show</Button>
          {(!isToday || input.leaderId || input.status || input.view) && (
            <Button asChild variant="ghost">
              <Link href="/app/journal">Today</Link>
            </Button>
          )}
        </div>
      </form>

      {input.leaderId && overview.leader && !overview.leader.isSelf && (
        <p className="text-sm">
          Viewing <strong>{overview.leader.name}</strong>’s {overview.view === 'branch' ? 'branch' : 'group'} ·{' '}
          <Link href={buildHref('/app/journal', { date: baseParams.date })} className="text-brand-deep underline">
            back to yours
          </Link>
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <li key={tile.status}>
            <Link
              href={buildHref('/app/journal', { ...baseParams, status: overview.status === tile.status ? undefined : tile.status })}
              aria-current={overview.status === tile.status ? 'true' : undefined}
              className={cn(
                'block rounded-[var(--radius-card)] border bg-surface p-4 transition-colors hover:border-brand-deep/40',
                overview.status === tile.status ? 'border-brand-deep ring-1 ring-brand-deep/30' : 'border-line',
              )}
            >
              <p className="text-sm text-muted">{tile.label}</p>
              <p className="tabular font-display text-3xl font-extrabold">{tile.value.toLocaleString('en-PH')}</p>
              {tile.note && <p className="text-xs text-muted">{tile.note}</p>}
            </Link>
          </li>
        ))}
      </ul>

      {overview.groups.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <h2 className="px-4 pt-4 text-base">Groups led by {overview.leader?.isSelf ? 'your members' : `${overview.leader?.name}’s members`}</h2>
          <ul className="mt-2 divide-y divide-line">
            {overview.groups.map((g) => (
              <li key={g.leaderId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link
                  href={buildHref('/app/journal', { date: baseParams.date, leaderId: g.leaderId, view: 'branch' })}
                  className="font-medium hover:text-brand-deep hover:underline"
                >
                  {g.leaderName}’s branch
                </Link>
                <span className="tabular text-muted">
                  {g.received} of {g.expected} received · {g.notYet} not yet
                  {g.missed > 0 ? ` · ${g.missed} no journal` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {overview.total === 0 ? (
        overview.status !== 'all' ? (
          <EmptyState
            icon={SearchX}
            title="No one with this status"
            action={
              <Button asChild variant="secondary">
                <Link href={buildHref('/app/journal', baseParams)}>Show everyone</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={NotebookPen}
            title="No one is expected to journal here yet"
            description="People appear once they are placed under a leader and their registration is confirmed."
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">{isToday ? 'Today' : formatDayLabel(overview.date, 'short')}</th>
                  {overview.view !== 'direct' && <th className="px-4 py-3 font-semibold">Leader</th>}
                  <th className="px-4 py-3 font-semibold">Last 7 days</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Notes</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.people.map((p) => (
                  <tr key={p.personId} className="hover:bg-ground/60">
                    <td className="px-4 py-3">
                      <Link href={`/app/journal/${p.personId}/${overview.date}`} className="font-medium text-ink hover:text-brand-deep hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <JournalStatus status={p.status} />
                      <p className="text-xs text-muted">
                        {p.receivedAt
                          ? formatClock(p.receivedAt, timezone)
                          : p.excuseReason
                            ? EXCUSE_LABEL[p.excuseReason]
                            : null}
                      </p>
                    </td>
                    {overview.view !== 'direct' && <td className="px-4 py-3 text-muted">{p.leaderName ?? '—'}</td>}
                    <td className="px-4 py-3">
                      <DayDots days={p.week} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {p.reviewStatus === 'awaiting' && canReview && <Badge tone="slate">Awaiting review</Badge>}
                        {/* Only that a photo is there. It is fetched when the journal is opened. */}
                        {p.proofAttached && (
                          <span className="inline-flex items-center gap-1 text-muted" title="A photo of the written journal was sent">
                            <Camera aria-hidden className="size-4" />
                            <span className="sr-only">Proof attached</span>
                          </span>
                        )}
                        {p.careStatus === 'needs_follow_up' && <Badge tone="amber">Follow-up</Badge>}
                        {p.byProxy && <Badge>Entered by a leader</Badge>}
                        {!p.isExpected && <Badge>Not expected yet</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={overview.page}
            pageSize={overview.pageSize}
            total={overview.total}
            basePath="/app/journal"
            params={{ ...baseParams, status: overview.status === 'all' ? undefined : overview.status }}
          />
        </>
      )}
    </div>
  );
}
