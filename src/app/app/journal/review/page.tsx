import { CircleCheckBig } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatClock, formatDayLabel } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { listAwaitingReview } from '@/server/modules/journal/journal-portal.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'Awaiting review' };

export default async function JournalReviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'journal.review')) notFound();
  const db = getDb();
  const { page } = await searchParams;
  const [queue, { timezone }] = await Promise.all([listAwaitingReview(db, ctx, { page }), getSetting(db, 'ministry.profile')]);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/journal', label: 'Daily Journal' }}
        title="Awaiting review"
        description="Journals from the last two weeks that no one has looked at yet. Oldest days first within each day’s arrivals."
      />

      {queue.total === 0 ? (
        <EmptyState icon={CircleCheckBig} title="You’re all caught up" description="New journals from your group will appear here." />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {queue.items.map((item) => (
              <li key={`${item.personId}-${item.journalDate}`}>
                <Link
                  href={`/app/journal/${item.personId}/${item.journalDate}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-ground/60"
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {item.timing === 'late' && <Badge tone="amber">Late</Badge>}
                    {formatDayLabel(item.journalDate, 'short')} · {formatClock(item.receivedAt, timezone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={queue.page} pageSize={queue.pageSize} total={queue.total} basePath="/app/journal/review" params={{}} />
        </>
      )}
    </div>
  );
}
