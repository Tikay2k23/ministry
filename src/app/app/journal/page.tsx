import { Camera, ChevronRight, ClipboardCheck, NotebookPen, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DayDots,
  EXCUSE_LABEL,
  formatClock,
  formatDayLabel,
  JournalStatus,
} from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref, Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';
import { isAppError } from '@/server/errors';
import {
  getJournalOverview,
  JOURNAL_PAGE_SIZES,
  listAwaitingReview,
  type JournalRoleFilter,
  type JournalSort,
  type JournalStatusFilter,
} from '@/server/modules/journal/journal-portal.service';
import { listMinistries } from '@/server/modules/ministries/ministries.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { JournalFilters } from './journal-filters';

export const metadata: Metadata = { title: 'Daily Journal' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ROLE_LABEL: Record<JournalRoleFilter, string> = {
  all: 'Everyone',
  primary_leader: 'Primary Leader',
  leader: 'Leader',
  worker: 'Worker',
  member: 'Member',
};

const STATUS_LABEL: Record<JournalStatusFilter, string> = {
  all: 'Everyone',
  received: 'Received',
  late: 'Received late',
  not_yet: 'Not yet',
  missed: 'No journal',
  excused: 'Excused',
  awaiting_review: 'Needs review',
  has_proof: 'With a photo',
};

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default async function JournalTodayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'journal.status.view')) notFound();
  const db = getDb();
  const sp = await searchParams;
  const input = {
    date: first(sp.date),
    primaryLeaderId: first(sp.primaryLeaderId),
    leaderId: first(sp.leaderId),
    view: first(sp.view),
    ministryId: first(sp.ministryId),
    role: first(sp.role),
    status: first(sp.status),
    q: first(sp.q),
    sort: first(sp.sort),
    pageSize: first(sp.size),
    page: first(sp.page),
  };

  let overview;
  try {
    overview = await getJournalOverview(db, ctx, input);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const canReview = hasPermission(ctx, 'journal.review');
  const [{ timezone }, policy, awaiting, ministries] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    getSetting(db, 'journal.policy'),
    canReview ? listAwaitingReview(db, ctx, {}) : Promise.resolve(null),
    hasPermission(ctx, 'ministries.view') ? listMinistries(db, ctx) : Promise.resolve([]),
  ]);
  const showProof = policy.proofImage !== 'off';

  const isToday = overview.date === overview.today;
  const s = overview.summary;

  // Every link on the page keeps the filters that are already set; only the one being changed moves.
  const base = {
    date: isToday ? undefined : overview.date,
    primaryLeaderId: overview.primaryLeader?.id,
    leaderId: overview.leader?.id,
    view: overview.leader ? overview.view : undefined,
    ministryId: overview.ministryId ?? undefined,
    role: overview.role === 'all' ? undefined : overview.role,
    q: overview.q ?? undefined,
    sort: overview.sort === 'status' ? undefined : overview.sort,
    size: overview.pageSize === 25 ? undefined : overview.pageSize,
    status: overview.status === 'all' ? undefined : overview.status,
  };
  const href = (over: Record<string, string | number | undefined>) =>
    buildHref('/app/journal', { ...base, ...over, page: undefined });

  // What the reader chose, not what the page worked out for them: a leader who simply opened the
  // page has not filtered anything, so there is nothing to reset.
  const activeCount = [
    base.date,
    base.primaryLeaderId,
    input.leaderId,
    base.ministryId,
    base.role,
    base.q,
    base.status,
  ].filter(Boolean).length;
  const rootLabel = hasGlobal(ctx, 'journal.status.view') ? 'All ministry' : 'Everyone you can see';

  const cards: {
    label: string;
    value: number;
    note?: string;
    share: boolean;
    status: JournalStatusFilter;
  }[] = [
    {
      label: 'Received',
      value: s.received,
      note: s.late > 0 ? `${s.late} late` : undefined,
      share: true,
      status: 'received',
    },
    { label: isToday ? 'Not yet' : 'Still open', value: s.notYet, share: true, status: 'not_yet' },
    { label: 'No journal', value: s.missed, share: true, status: 'missed' },
    // A day that was excused was never expected, so there is no share of the expected count to give.
    { label: 'Excused', value: s.excused, note: 'not expected today', share: false, status: 'excused' },
  ];
  const chips: { label: string; value: JournalStatusFilter; count: number }[] = [
    { label: 'Everyone', value: 'all', count: overview.totals.all },
    { label: 'Received late', value: 'late', count: overview.totals.late },
    ...(canReview
      ? [{ label: 'Needs review', value: 'awaiting_review' as const, count: overview.totals.awaiting_review }]
      : []),
    ...(showProof
      ? [{ label: 'With a photo', value: 'has_proof' as const, count: overview.totals.has_proof }]
      : []),
  ];

  /** A sortable column header. The sort itself happens in the database, never in the page. */
  const sortable = (label: string, value: JournalSort, className = 'px-4 py-3 font-semibold') => (
    <th scope="col" className={className} aria-sort={overview.sort === value ? 'ascending' : 'none'}>
      <Link
        href={href({ sort: value === 'status' ? undefined : value })}
        className={cn(
          'inline-flex items-center gap-1 hover:text-ink',
          overview.sort === value && 'text-ink underline',
        )}
      >
        {label}
      </Link>
    </th>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Journal"
        description={
          <>
            {formatDayLabel(overview.date)} ·{' '}
            <span className="tabular">
              {s.received} of {s.expected} received ({percent(s.received, s.expected)}%)
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

      {/* Where you are in the ministry: all of it, then one Primary Leader, then one of their leaders. */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        {overview.primaryLeader || overview.leader ? (
          <Link
            href={href({ primaryLeaderId: undefined, leaderId: undefined, view: undefined })}
            className="text-brand-deep hover:underline"
          >
            {rootLabel}
          </Link>
        ) : (
          <span className="font-medium">{rootLabel}</span>
        )}
        {overview.primaryLeader && (
          <>
            <ChevronRight aria-hidden className="size-4 text-muted" />
            {overview.leader ? (
              <Link
                href={href({ leaderId: undefined, view: undefined })}
                className="text-brand-deep hover:underline"
              >
                {overview.primaryLeader.name}
              </Link>
            ) : (
              <span className="font-medium">{overview.primaryLeader.name}</span>
            )}
          </>
        )}
        {overview.leader && (
          <>
            <ChevronRight aria-hidden className="size-4 text-muted" />
            <span className="font-medium">
              {overview.view === 'branch'
                ? `${overview.leader.isSelf ? 'Your' : `${overview.leader.name}’s`} whole branch`
                : overview.leader.isSelf
                  ? 'Your group'
                  : overview.leader.name}
            </span>
            {/* A switch, not another crumb — on a phone this wraps onto its own line. */}
            <span aria-hidden className="ml-1 text-muted">
              ·
            </span>
            <Link
              href={href({ view: overview.view === 'branch' ? 'direct' : 'branch' })}
              className="text-brand-deep hover:underline"
            >
              {overview.view === 'branch'
                ? `show just ${overview.leader.isSelf ? 'your' : 'their'} group`
                : `show ${overview.leader.isSelf ? 'your' : 'their'} whole branch`}
            </Link>
          </>
        )}
      </nav>

      {/* One card per Primary Leader. Nothing here is typed in: the day itself records the branch. */}
      {overview.branches.length > 1 && (
        <section>
          <h2 className="sr-only">Groups</h2>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {overview.branches.map((b) => {
              const selected = overview.primaryLeader?.id === b.primaryLeaderId;
              return (
                <li key={b.primaryLeaderId}>
                  <Link
                    href={href({
                      primaryLeaderId: selected ? undefined : b.primaryLeaderId,
                      leaderId: undefined,
                      view: undefined,
                    })}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'block h-full rounded-[var(--radius-card)] border bg-surface px-3 py-2.5 transition-colors hover:border-brand-deep/40',
                      selected ? 'border-brand-deep ring-1 ring-brand-deep/30' : 'border-line',
                    )}
                  >
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="tabular text-xl font-extrabold">
                      {b.received}
                      <span className="text-sm font-normal text-muted"> / {b.expected}</span>
                      <span className="text-xs font-normal text-muted">
                        {' '}
                        · {percent(b.received, b.expected)}%
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {b.notYet > 0 ? `${b.notYet} not yet` : 'all in'}
                      {b.missed > 0 ? ` · ${b.missed} no journal` : ''}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <JournalFilters
        key={`${overview.date}|${overview.primaryLeader?.id ?? ''}|${input.leaderId ?? ''}|${overview.ministryId ?? ''}|${overview.role}|${overview.status}|${overview.q ?? ''}|${overview.sort}|${overview.view}`}
        date={overview.date}
        today={overview.today}
        primaryLeaderId={overview.primaryLeader?.id ?? ''}
        leaderId={input.leaderId ?? ''}
        ministryId={overview.ministryId ?? ''}
        role={overview.role}
        status={overview.status}
        q={overview.q ?? ''}
        sort={overview.sort}
        view={overview.leader ? overview.view : ''}
        branches={overview.branches.map((b) => ({ value: b.primaryLeaderId, label: b.name }))}
        branchLeaders={(overview.branchLeaders.length
          ? overview.branchLeaders
          : overview.groups.map((g) => ({ id: g.leaderId, name: g.leaderName }))
        ).map((l) => ({ value: l.id, label: l.name }))}
        ministries={ministries.map((m) => ({ value: m.id, label: m.name }))}
        roles={(Object.keys(ROLE_LABEL) as JournalRoleFilter[]).map((r) => ({
          value: r,
          label: ROLE_LABEL[r],
        }))}
        statuses={(Object.keys(STATUS_LABEL) as JournalStatusFilter[])
          .filter((v) => (canReview || v !== 'awaiting_review') && (showProof || v !== 'has_proof'))
          .map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
        contactHint={overview.contactVisible}
        activeCount={activeCount}
      />

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => {
          const selected = overview.status === card.status;
          return (
            <li key={card.status}>
              <Link
                href={href({ status: selected ? undefined : card.status })}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'block rounded-[var(--radius-card)] border bg-surface p-4 transition-colors hover:border-brand-deep/40',
                  selected ? 'border-brand-deep ring-1 ring-brand-deep/30' : 'border-line',
                )}
              >
                <p className="text-sm text-muted">{card.label}</p>
                <p className="tabular font-display text-3xl font-extrabold">
                  {card.value.toLocaleString('en-PH')}
                </p>
                <p className="text-xs text-muted">
                  {card.share &&
                    `${percent(card.value, s.expected)}% of ${s.expected.toLocaleString('en-PH')}`}
                  {card.share && card.note ? ' · ' : ''}
                  {card.note}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const selected =
            overview.status === chip.value || (chip.value === 'all' && overview.status === 'all');
          return (
            <Link
              key={chip.value}
              href={href({ status: chip.value === 'all' ? undefined : chip.value })}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-brand-deep bg-brand-leaf-tint text-brand-deep'
                  : 'border-line bg-surface hover:border-brand-deep/40',
              )}
            >
              {chip.label}
              <span className="tabular text-xs text-muted">{chip.count.toLocaleString('en-PH')}</span>
            </Link>
          );
        })}
      </div>

      {overview.groups.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <h2 className="px-4 pt-4 text-base">
            Groups led by {overview.leader?.isSelf ? 'your members' : `${overview.leader?.name}’s members`}
          </h2>
          <ul className="mt-2 divide-y divide-line">
            {overview.groups.map((g) => (
              <li
                key={g.leaderId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <Link
                  href={href({ leaderId: g.leaderId, view: 'branch' })}
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
        activeCount > 0 ? (
          <EmptyState
            icon={SearchX}
            title="No one matches these filters"
            description="Try a wider group, or clear the filters to see everyone for this day."
            action={
              <Button asChild variant="secondary">
                <Link href="/app/journal">Clear filters</Link>
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
          {/* Phones get a card each: a seven-column table on a 375px screen is unreadable. */}
          <ul className="space-y-3 md:hidden">
            {overview.people.map((p) => (
              <li key={p.personId} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/app/journal/${p.personId}/${overview.date}`}
                      className="font-medium text-ink hover:text-brand-deep hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {ROLE_LABEL[p.role]}
                      {p.ministryName ? ` · ${p.ministryName}` : ''}
                      {p.leaderName ? ` · ${p.leaderName}` : ''}
                    </p>
                  </div>
                  <JournalStatus status={p.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
                  <DayDots days={p.week} />
                  {p.receivedAt && <span>{formatClock(p.receivedAt, timezone)}</span>}
                  {p.excuseReason && <span>{EXCUSE_LABEL[p.excuseReason]}</span>}
                  {showProof && p.proofAttached && (
                    <span className="inline-flex items-center gap-1">
                      <Camera aria-hidden className="size-4" /> Photo
                    </span>
                  )}
                  {p.reviewStatus === 'awaiting' && canReview && <Badge tone="slate">Needs review</Badge>}
                  {p.careStatus === 'needs_follow_up' && <Badge tone="amber">Follow-up</Badge>}
                  {p.byProxy && <Badge>Entered by a leader</Badge>}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface md:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <tr>
                  {sortable('Name', 'name')}
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Role
                  </th>
                  {/* The two columns a narrow window can live without: the phone cards keep both. */}
                  <th scope="col" className="hidden px-4 py-3 font-semibold lg:table-cell">
                    Ministry
                  </th>
                  {sortable(isToday ? 'Today' : formatDayLabel(overview.date, 'short'), 'status')}
                  {sortable('Leader', 'leader', 'hidden px-4 py-3 font-semibold lg:table-cell')}
                  {showProof && (
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Photo
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Last 7 days
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.people.map((p) => (
                  <tr key={p.personId} className="hover:bg-ground/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/journal/${p.personId}/${overview.date}`}
                        className="font-medium text-ink hover:text-brand-deep hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="flex flex-wrap gap-1.5 pt-1">
                        {p.careStatus === 'needs_follow_up' && <Badge tone="amber">Follow-up</Badge>}
                        {p.byProxy && <Badge>Entered by a leader</Badge>}
                        {!p.isExpected && <Badge>Not expected yet</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{ROLE_LABEL[p.role]}</td>
                    <td className="hidden px-4 py-3 text-muted lg:table-cell">{p.ministryName ?? '—'}</td>
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
                    <td className="hidden px-4 py-3 text-muted lg:table-cell">{p.leaderName ?? '—'}</td>
                    {/* Only that a photo is there. It is fetched when the journal is opened. */}
                    {showProof && (
                      <td className="px-4 py-3">
                        {p.proofAttached ? (
                          <span
                            className="inline-flex items-center gap-1 text-muted"
                            title="A photo of the written journal was sent"
                          >
                            <Camera aria-hidden className="size-4" />
                            <span className="sr-only">Photo attached</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <DayDots days={p.week} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/app/journal/${p.personId}/${overview.date}`}
                        className="text-brand-deep hover:underline"
                      >
                        {p.reviewStatus === 'awaiting' && canReview ? 'Review' : 'Open'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-muted">
              Rows
              {JOURNAL_PAGE_SIZES.map((size) => (
                <Link
                  key={size}
                  href={href({ size: size === 25 ? undefined : size })}
                  aria-current={overview.pageSize === size ? 'true' : undefined}
                  className={cn(
                    'tabular rounded-lg border px-2 py-1',
                    overview.pageSize === size ? 'border-brand-deep text-ink' : 'border-line',
                  )}
                >
                  {size}
                </Link>
              ))}
            </p>
            <Pagination
              page={overview.page}
              pageSize={overview.pageSize}
              total={overview.total}
              basePath="/app/journal"
              params={base}
            />
          </div>
        </>
      )}
    </div>
  );
}
