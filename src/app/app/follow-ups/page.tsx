import { HeartHandshake } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref, Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { listFollowUps } from '@/server/modules/care/care.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { FollowUpActions } from './follow-up-actions';

export const metadata: Metadata = { title: 'Follow-ups' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'care.view')) notFound();
  const db = getDb();
  const sp = await searchParams;
  const [result, { timezone }] = await Promise.all([
    listFollowUps(db, ctx, { status: first(sp.status), assigned: first(sp.assigned), page: first(sp.page) }),
    getSetting(db, 'ministry.profile'),
  ]);
  const canManage = hasPermission(ctx, 'care.manage');
  const pastoral = hasPermission(ctx, 'care.pastoral.view');
  const params = {
    status: result.status === 'open' ? undefined : result.status,
    assigned: result.assigned === 'anyone' ? undefined : result.assigned,
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Follow-ups" description="People who may need a call, a visit or a prayer. Handle them gently and in your own time." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Status" className="flex gap-2">
          <Tab href={buildHref('/app/follow-ups', { ...params, status: undefined })} active={result.status === 'open'}>
            Open
          </Tab>
          <Tab href={buildHref('/app/follow-ups', { ...params, status: 'closed' })} active={result.status === 'closed'}>
            Closed
          </Tab>
        </nav>
        <nav aria-label="Assigned to" className="flex flex-wrap gap-2">
          <Tab href={buildHref('/app/follow-ups', { ...params, assigned: undefined })} active={result.assigned === 'anyone'}>
            Everyone’s
          </Tab>
          <Tab href={buildHref('/app/follow-ups', { ...params, assigned: 'me' })} active={result.assigned === 'me'}>
            Mine
          </Tab>
          {pastoral && (
            <Tab href={buildHref('/app/follow-ups', { ...params, assigned: 'pastoral_pool' })} active={result.assigned === 'pastoral_pool'}>
              Waiting for a pastor
            </Tab>
          )}
        </nav>
      </div>

      {result.total === 0 ? (
        <EmptyState
          icon={HeartHandshake}
          title={result.status === 'open' ? 'No open follow-ups' : 'Nothing closed yet'}
          description={
            result.status === 'open' ? 'Follow-ups appear when someone misses several journals or a leader asks for one.' : undefined
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {result.items.map((item) => (
              <li key={item.id} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Link href={`/app/people/${item.person.id}`} className="font-semibold hover:text-brand-deep hover:underline">
                      {item.person.name}
                    </Link>
                    <p className="text-sm">{item.summary}</p>
                    <p className="text-xs text-muted">
                      {item.kindLabel} · opened {formatDateTime(item.createdAt, timezone)} ·{' '}
                      {item.assignedTo
                        ? item.isMine
                          ? 'with you'
                          : `with ${item.assignedTo}`
                        : item.visibility === 'pastoral'
                          ? 'waiting for a pastor'
                          : 'not assigned yet'}
                      {item.resolvedAt && ` · closed ${formatDateTime(item.resolvedAt, timezone)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.visibility === 'pastoral' && <Badge tone="slate">Pastoral</Badge>}
                    {item.status === 'in_progress' && <Badge tone="amber">In progress</Badge>}
                    {item.status === 'resolved' && <Badge tone="green">Resolved</Badge>}
                    {item.status === 'dismissed' && <Badge>Not needed</Badge>}
                  </div>
                </div>
                {item.journalDate && (
                  <Link href={`/app/journal/${item.person.id}/${item.journalDate}`} className="inline-block text-sm text-brand-deep hover:underline">
                    Open the journal for {formatDayLabel(item.journalDate)}
                  </Link>
                )}
                {item.resolutionNote && <p className="rounded-lg bg-ground px-3 py-2 text-sm whitespace-pre-wrap">{item.resolutionNote}</p>}
                {canManage && <FollowUpActions followUpId={item.id} status={item.status} isMine={item.isMine} />}
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/app/follow-ups" params={params} />
        </>
      )}
    </div>
  );
}
