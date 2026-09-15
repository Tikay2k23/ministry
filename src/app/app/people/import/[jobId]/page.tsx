import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref, Pagination } from '@/components/ui/pagination';
import { isAppError } from '@/server/errors';
import { IMPORT_ROW_OUTCOMES } from '@/server/db/enums';
import { getImportJob } from '@/server/modules/import/people-import.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CommitPanel } from './commit-panel';

export const metadata: Metadata = { title: 'Import preview' };

const OUTCOME: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'neutral' }> = {
  valid: { label: 'Ready', tone: 'green' },
  warning: { label: 'Ready, with notes', tone: 'amber' },
  error: { label: 'Error', tone: 'red' },
  duplicate_candidate: { label: 'Already in directory', tone: 'slate' },
  skipped: { label: 'Already in directory', tone: 'slate' },
  imported: { label: 'Imported', tone: 'green' },
};
const PLACEMENT: Record<string, string> = { under_leader: 'Under leader', root: 'Top of structure', unplaced: 'Not placed' };
const FILTERS = [
  { value: undefined, label: 'All rows' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Notes' },
  { value: 'duplicate_candidate', label: 'Already in directory' },
  { value: 'valid', label: 'Ready' },
  { value: 'imported', label: 'Imported' },
] as const;

export default async function ImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ outcome?: string; page?: string }>;
}) {
  const { jobId } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePortal();
  const outcome = IMPORT_ROW_OUTCOMES.find((o) => o === sp.outcome);
  const page = Math.max(1, Number(sp.page) || 1);

  let data;
  try {
    data = await getImportJob(getDb(), ctx, jobId, { outcome, page });
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const { job, rows, outcomeCounts } = data;
  const stats = job.stats as {
    total?: number;
    willCreate?: number;
    error?: number;
    warning?: number;
    duplicate?: number;
    skipped?: number;
    roots?: number;
    unplaced?: number;
    imported?: number;
    placed?: number;
    unknownColumns?: string[];
  };

  const tiles = [
    { label: 'Rows in file', value: stats.total ?? 0 },
    { label: 'Will be imported', value: stats.willCreate ?? 0 },
    { label: 'Errors', value: stats.error ?? 0 },
    { label: 'Already in directory', value: (stats.duplicate ?? 0) + (stats.skipped ?? 0) },
    { label: 'Not placed (no leader)', value: stats.unplaced ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/people/import', label: 'Import people' }}
        title={job.fileName}
        description={
          job.status === 'previewed'
            ? 'Preview — nothing has been saved yet.'
            : job.status === 'completed'
              ? 'This import is complete.'
              : `This import was ${job.status}.`
        }
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className="tabular font-display text-2xl font-extrabold">{t.value.toLocaleString('en-PH')}</dd>
          </div>
        ))}
      </dl>

      {stats.unknownColumns && stats.unknownColumns.length > 0 && (
        <Alert tone="info" title="Some columns were ignored">
          {stats.unknownColumns.join(', ')}
        </Alert>
      )}

      {job.status === 'previewed' && <CommitPanel jobId={job.id} willCreate={stats.willCreate ?? 0} errors={stats.error ?? 0} />}
      {job.status === 'completed' && (
        <Alert tone="success" title={`${(stats.imported ?? 0).toLocaleString('en-PH')} people imported`}>
          {(stats.placed ?? 0).toLocaleString('en-PH')} placed in the leadership structure.{' '}
          <Link href="/app/leadership" className="font-semibold underline">
            View the structure
          </Link>
        </Alert>
      )}
      {job.status === 'failed' && (
        <Alert tone="error" title="The import failed">
          Nothing was saved. Please try again; if it keeps failing, contact your system administrator.
        </Alert>
      )}

      <nav aria-label="Filter rows" className="flex flex-wrap gap-2">
        {FILTERS.filter((f) => !f.value || outcomeCounts[f.value]).map((f) => {
          const active = outcome === f.value;
          const count = f.value ? outcomeCounts[f.value] : Object.values(outcomeCounts).reduce((a, b) => a + b, 0);
          return (
            <Link
              key={f.label}
              href={buildHref(`/app/people/import/${job.id}`, { outcome: f.value })}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full bg-brand-deep px-3 py-1 text-sm font-medium text-white'
                  : 'rounded-full border border-line-strong px-3 py-1 text-sm hover:bg-ground'
              }
            >
              {f.label} <span className="tabular opacity-80">{count}</span>
            </Link>
          );
        })}
      </nav>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Row</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Leader</th>
              <th className="px-4 py-3 font-semibold">Placement</th>
              <th className="px-4 py-3 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.rowNo} className="align-top">
                <td className="tabular px-4 py-3 text-muted">{row.rowNo}</td>
                <td className="px-4 py-3 font-medium">
                  {row.createdPersonId || row.matchedPersonId ? (
                    <Link href={`/app/people/${row.createdPersonId ?? row.matchedPersonId}`} className="hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{row.leader ?? '—'}</td>
                <td className="px-4 py-3 text-muted">{row.placement && row.outcome !== 'error' ? PLACEMENT[row.placement] : '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={OUTCOME[row.outcome]?.tone ?? 'neutral'}>{OUTCOME[row.outcome]?.label ?? row.outcome}</Badge>
                  {row.messages.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {row.messages.map((m, i) => (
                        <li key={i} className={m.level === 'error' ? 'text-error' : 'text-muted'}>
                          {m.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath={`/app/people/import/${job.id}`} params={{ outcome }} />
    </div>
  );
}
