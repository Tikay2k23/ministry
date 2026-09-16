import { Download, HandHeart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { isAppError } from '@/server/errors';
import { getPrayerCompletionReport } from '@/server/modules/reports/prayer-reports.service';
import { hasChainScope, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ReportModules } from '../report-modules';
import { PrayerDaysChart } from './prayer-days-chart';

export const metadata: Metadata = { title: 'Prayer Chain report' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const count = (n: number) => (n === 0 ? '—' : n.toLocaleString('en-PH'));
const share = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`);

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

/** Prayer chain completion by day and by person (docs/01 FR-RPT-02, docs/04 A23). */
export default async function PrayerReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'reports.view') || !hasChainScope(ctx, 'prayer.view')) notFound();
  const db = getDb();
  const sp = await searchParams;
  const tab = first(sp.tab) === 'people' ? 'people' : 'days';
  const input = { chainId: first(sp.chainId), from: first(sp.from), to: first(sp.to) };

  let problem: string | null = null;
  let report: Awaited<ReturnType<typeof getPrayerCompletionReport>>;
  try {
    report = await getPrayerCompletionReport(db, ctx, input);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error;
    problem = Object.values(error.details.fieldErrors ?? {}).flat()[0] ?? error.message;
    report = await getPrayerCompletionReport(db, ctx, { chainId: input.chainId });
  }

  const data = report.chain !== null ? report : null;
  const period = { chainId: data?.chain.id, from: data?.from, to: data?.to };
  const canExport = hasPermission(ctx, 'reports.export');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="How the prayer chains were covered over a period. Reports count slots only — never what anyone wrote."
        actions={
          canExport && data ? (
            <Button asChild variant="secondary">
              <a href={buildHref('/api/reports/prayer.csv', { ...period, tab })}>
                <Download aria-hidden className="size-4" /> Download CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <ReportModules active="prayer" journal={hasPermission(ctx, 'journal.status.view')} prayer />

      {!data ? (
        <EmptyState icon={HandHeart} title="No prayer chains to report on" description="Chains you coordinate or can see will appear here." />
      ) : (
        <>
          <nav aria-label="Report" className="flex flex-wrap gap-2">
            <Tab href={buildHref('/app/reports/prayer', period)} active={tab === 'days'}>
              By day
            </Tab>
            <Tab href={buildHref('/app/reports/prayer', { ...period, tab: 'people' })} active={tab === 'people'}>
              By person
            </Tab>
          </nav>

          <form method="get" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            {tab === 'people' && <input type="hidden" name="tab" value="people" />}
            <div className="space-y-1">
              <label htmlFor="chainId" className="text-xs font-semibold tracking-wider text-muted uppercase">
                Chain
              </label>
              <select id="chainId" name="chainId" defaultValue={data.chain.id} className={inputClassName}>
                {data.chains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="from" className="text-xs font-semibold tracking-wider text-muted uppercase">
                From
              </label>
              <input id="from" name="from" type="date" max={data.today} defaultValue={data.from} className={inputClassName} />
            </div>
            <div className="space-y-1">
              <label htmlFor="to" className="text-xs font-semibold tracking-wider text-muted uppercase">
                To
              </label>
              <input id="to" name="to" type="date" max={data.today} defaultValue={data.to} className={inputClassName} />
            </div>
            <div className="flex items-end">
              <Button type="submit">Show</Button>
            </div>
          </form>

          {problem && <Alert tone="error">{problem}</Alert>}

          <p className="text-sm text-muted">
            {data.chain.name} · {formatDayLabel(data.from, 'short')} – {formatDayLabel(data.to, 'short')}
          </p>

          {data.days.length === 0 ? (
            <EmptyState icon={HandHeart} title="No prayer slots in this period" />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Slots', value: data.totals.slots, note: null },
                  { label: 'Covered', value: data.totals.covered, note: share(data.totals.covered, data.totals.slots) },
                  { label: 'Prayed', value: data.totals.prayed, note: share(data.totals.prayed, data.totals.slots) },
                  { label: 'Needs follow-up', value: data.totals.followUp, note: null },
                ].map((tile) => (
                  <li key={tile.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                    <p className="text-sm text-muted">{tile.label}</p>
                    <p className="tabular font-display text-3xl font-extrabold">{tile.value.toLocaleString('en-PH')}</p>
                    {tile.note && <p className="text-xs text-muted">{tile.note} of slots</p>}
                  </li>
                ))}
              </ul>

              {tab === 'days' ? (
                <>
                  {data.days.length > 1 && <PrayerDaysChart days={data.days.map((day) => ({ ...day, label: formatDayLabel(day.date, 'short') }))} />}
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Day</TableHead>
                        <TableHead className="text-right">Slots</TableHead>
                        <TableHead className="text-right">Covered</TableHead>
                        <TableHead className="text-right">Prayed</TableHead>
                        <TableHead className="text-right">Late</TableHead>
                        <TableHead className="text-right">Follow-up</TableHead>
                        <TableHead className="text-right">Missed</TableHead>
                        <TableHead className="text-right">Excused</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.days.map((day) => (
                        <TableRow key={day.date}>
                          <TableCell>
                            <Link
                              href={`/app/prayer/${data.chain.id}?date=${day.date}`}
                              className="font-medium hover:text-brand-deep hover:underline"
                            >
                              {formatDayLabel(day.date, 'short')}
                            </Link>
                          </TableCell>
                          <TableCell className="tabular text-right">{count(day.slots)}</TableCell>
                          <TableCell className="tabular text-right">{count(day.covered)}</TableCell>
                          <TableCell className="tabular text-right">{count(day.prayed)}</TableCell>
                          <TableCell className="tabular text-right text-muted">{count(day.late)}</TableCell>
                          <TableCell className="tabular text-right text-muted">{count(day.followUp)}</TableCell>
                          <TableCell className="tabular text-right text-muted">{count(day.missed)}</TableCell>
                          <TableCell className="tabular text-right text-muted">{count(day.excused)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold hover:bg-transparent">
                        <TableCell>Total</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.slots)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.covered)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.prayed)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.late)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.followUp)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.missed)}</TableCell>
                        <TableCell className="tabular text-right">{count(data.totals.excused)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              ) : data.people.length === 0 ? (
                <EmptyState icon={HandHeart} title="No one was on a slot in this period" />
              ) : (
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Slots</TableHead>
                      <TableHead className="text-right">Finished</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">Follow-up</TableHead>
                      <TableHead className="text-right">Missed</TableHead>
                      <TableHead className="text-right">Excused</TableHead>
                      <TableHead className="text-right">Handed over</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.people.map((person) => (
                      <TableRow key={person.personId}>
                        <TableCell className="font-medium">{person.name}</TableCell>
                        <TableCell className="tabular text-right">{count(person.slots)}</TableCell>
                        <TableCell className="tabular text-right">{count(person.completed)}</TableCell>
                        <TableCell className="tabular text-right text-muted">{count(person.late)}</TableCell>
                        <TableCell className="tabular text-right text-muted">{count(person.followUp)}</TableCell>
                        <TableCell className="tabular text-right text-muted">{count(person.missed)}</TableCell>
                        <TableCell className="tabular text-right text-muted">{count(person.excused)}</TableCell>
                        <TableCell className="tabular text-right text-muted">{count(person.handedOver)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
