import { ClipboardList, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DayDots, formatDayLabel } from '@/components/journal/journal-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';
import { isAppError } from '@/server/errors';
import { getJournalGroupsReport, getJournalPeopleReport } from '@/server/modules/reports/journal-reports.service';
import { hasChainScope, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ReportModules } from './report-modules';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Record<string, string | string[] | undefined>;
type PeopleReport = Awaited<ReturnType<typeof getJournalPeopleReport>>;
type GroupsReport = Awaited<ReturnType<typeof getJournalGroupsReport>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "5 of 6": received journals out of days that were due (received + no journal). */
function receivedOfDue(received: number, missed: number) {
  return received + missed === 0 ? '—' : `${received.toLocaleString('en-PH')} of ${(received + missed).toLocaleString('en-PH')}`;
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium',
        active ? 'bg-brand-deep text-white' : 'bg-surface text-ink ring-1 ring-line hover:bg-ground',
      )}
    >
      {children}
    </Link>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'reports.view')) notFound();
  const prayerReports = hasChainScope(ctx, 'prayer.view');
  if (!hasPermission(ctx, 'journal.status.view')) {
    // Prayer chain coordinators have reports but no journal access.
    if (prayerReports) redirect('/app/reports/prayer');
    notFound();
  }
  const db = getDb();
  const sp = await searchParams;
  const tab = first(sp.tab) === 'groups' ? 'groups' : 'people';
  const input = { from: first(sp.from), to: first(sp.to), leaderId: first(sp.leaderId), view: first(sp.view) };

  let peopleReport: PeopleReport | null = null;
  let groupsReport: GroupsReport | null = null;
  let problem: string | null = null;
  try {
    if (tab === 'people') peopleReport = await getJournalPeopleReport(db, ctx, input);
    else groupsReport = await getJournalGroupsReport(db, ctx, input);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error;
    problem = Object.values(error.details.fieldErrors ?? {}).flat()[0] ?? error.message;
  }

  const report = peopleReport ?? groupsReport;
  const period = { from: report?.from ?? input.from, to: report?.to ?? input.to, leaderId: input.leaderId };
  const canExport = hasPermission(ctx, 'reports.export');
  const exportHref = buildHref('/api/reports/journal.csv', {
    kind: tab,
    ...period,
    view: tab === 'people' ? input.view : undefined,
  });
  const scopeName = (leader: { name: string; isSelf: boolean } | null, view: string) =>
    !leader ? 'Everyone you can see' : `${leader.isSelf ? 'Your' : `${leader.name}’s`} ${view === 'branch' ? 'whole branch' : 'group'}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="How journaling is going over a period. Reports show status only — never journal answers."
        actions={
          canExport && report ? (
            <Button asChild variant="secondary">
              <a href={exportHref}>
                <Download aria-hidden className="size-4" /> Download CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <ReportModules active="journal" journal prayer={prayerReports} />

      <nav aria-label="Report" className="flex flex-wrap gap-2">
        <Tab href={buildHref('/app/reports', { ...period, view: input.view })} active={tab === 'people'}>
          By person
        </Tab>
        <Tab href={buildHref('/app/reports', { ...period, tab: 'groups' })} active={tab === 'groups'}>
          By group
        </Tab>
      </nav>

      <form method="get" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        {tab === 'groups' && <input type="hidden" name="tab" value="groups" />}
        {input.leaderId && <input type="hidden" name="leaderId" value={input.leaderId} />}
        <div className="space-y-1">
          <label htmlFor="from" className="text-xs font-semibold uppercase tracking-wider text-muted">
            From
          </label>
          <input id="from" name="from" type="date" max={report?.today} defaultValue={period.from} className={inputClassName} />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="text-xs font-semibold uppercase tracking-wider text-muted">
            To
          </label>
          <input id="to" name="to" type="date" max={report?.today} defaultValue={period.to} className={inputClassName} />
        </div>
        {tab === 'people' && (peopleReport?.leader || input.view === 'all') ? (
          <div className="space-y-1">
            <label htmlFor="view" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Show
            </label>
            <select id="view" name="view" defaultValue={peopleReport?.view ?? input.view} className={inputClassName}>
              <option value="direct">Direct group</option>
              <option value="branch">Whole branch</option>
              <option value="all">Everyone I can see</option>
            </select>
          </div>
        ) : (
          <div aria-hidden className="hidden lg:block" />
        )}
        <div className="flex items-end">
          <Button type="submit">Show</Button>
        </div>
      </form>

      {problem && <Alert tone="error">{problem}</Alert>}

      {peopleReport && (
        <section className="space-y-3">
          <p className="text-sm text-muted">
            {scopeName(peopleReport.leader, peopleReport.view)} · {formatDayLabel(peopleReport.from, 'short')} –{' '}
            {formatDayLabel(peopleReport.to, 'short')} · received {receivedOfDue(peopleReport.totals.received, peopleReport.totals.missed)} due
            days
            {peopleReport.totals.late > 0 ? ` · ${peopleReport.totals.late} late` : ''}
            {peopleReport.totals.excused > 0 ? ` · ${peopleReport.totals.excused} excused` : ''}
          </p>
          {peopleReport.rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No journal records in this period" />
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    {peopleReport.view !== 'direct' && <th className="px-4 py-3 font-semibold">Leader</th>}
                    {peopleReport.dates.length <= 31 && <th className="px-4 py-3 font-semibold">Days</th>}
                    <th className="px-4 py-3 text-right font-semibold">Received</th>
                    <th className="px-4 py-3 text-right font-semibold">Late</th>
                    <th className="px-4 py-3 text-right font-semibold">Excused</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {peopleReport.rows.map((r) => (
                    <tr key={r.personId} className="hover:bg-ground/60">
                      <td className="px-4 py-3">
                        <Link href={`/app/people/${r.personId}`} className="font-medium hover:text-brand-deep hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      {peopleReport.view !== 'direct' && <td className="px-4 py-3 text-muted">{r.leaderName ?? '—'}</td>}
                      {peopleReport.dates.length <= 31 && (
                        <td className="px-4 py-3">
                          <DayDots days={peopleReport.dates.map((d) => ({ date: d, status: r.days[d] ?? null }))} />
                        </td>
                      )}
                      <td className="tabular px-4 py-3 text-right">{receivedOfDue(r.received, r.missed)}</td>
                      <td className="tabular px-4 py-3 text-right text-muted">{r.late || '—'}</td>
                      <td className="tabular px-4 py-3 text-right text-muted">{r.excused || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {peopleReport.truncated && <Alert tone="info">Showing the first 5,000 people. Choose a smaller group to see everyone.</Alert>}
        </section>
      )}

      {groupsReport &&
        (groupsReport.leader && groupsReport.direct && groupsReport.branch ? (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: `${groupsReport.leader.isSelf ? 'Your' : `${groupsReport.leader.name}’s`} direct group`, counts: groupsReport.direct },
                { label: 'Whole branch', counts: groupsReport.branch },
              ].map(({ label, counts }) => (
                <div key={label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                  <p className="text-sm text-muted">
                    {label} · {counts.people.toLocaleString('en-PH')} people
                  </p>
                  <p className="tabular font-display text-2xl font-extrabold">{receivedOfDue(counts.received, counts.missed)}</p>
                  <p className="text-xs text-muted">
                    journals received of days due
                    {counts.late > 0 ? ` · ${counts.late} late` : ''}
                    {counts.excused > 0 ? ` · ${counts.excused} excused` : ''}
                  </p>
                </div>
              ))}
            </div>
            {groupsReport.rows.length === 0 ? (
              <p className="text-sm text-muted">No one in this group leads a group of their own yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Group</th>
                      <th className="px-4 py-3 text-right font-semibold">People</th>
                      <th className="px-4 py-3 text-right font-semibold">Received</th>
                      <th className="px-4 py-3 text-right font-semibold">Late</th>
                      <th className="px-4 py-3 text-right font-semibold">Excused</th>
                      <th className="px-4 py-3">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {groupsReport.rows.map((g) => (
                      <tr key={g.leaderId} className="hover:bg-ground/60">
                        <td className="px-4 py-3">
                          <Link
                            href={buildHref('/app/reports', { tab: 'groups', from: groupsReport.from, to: groupsReport.to, leaderId: g.leaderId })}
                            className="font-medium hover:text-brand-deep hover:underline"
                          >
                            {g.name}’s branch
                          </Link>
                        </td>
                        <td className="tabular px-4 py-3 text-right">{g.people.toLocaleString('en-PH')}</td>
                        <td className="tabular px-4 py-3 text-right">{receivedOfDue(g.received, g.missed)}</td>
                        <td className="tabular px-4 py-3 text-right text-muted">{g.late || '—'}</td>
                        <td className="tabular px-4 py-3 text-right text-muted">{g.excused || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={buildHref('/app/reports', { from: groupsReport.from, to: groupsReport.to, leaderId: g.leaderId, view: 'branch' })}
                            className="text-sm text-brand-deep hover:underline"
                          >
                            People
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Choose a leader to compare groups"
            description="Open a leader’s branch from the Daily Journal page to see how their groups are doing."
          />
        ))}
    </div>
  );
}
