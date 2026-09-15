import { UserCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/dates';
import { listUnconfirmedRegistrations } from '@/server/modules/people/registrations.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DecideRegistration } from './decide-registration';

export const metadata: Metadata = { title: 'New registrations' };

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'people.registrations.confirm')) notFound();
  const db = getDb();
  const { page } = await searchParams;
  const [result, { timezone }] = await Promise.all([listUnconfirmedRegistrations(db, ctx, { page }), getSetting(db, 'ministry.profile')]);
  const canReviewDuplicates = hasGlobal(ctx, 'people.merge');

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/people', label: 'People' }}
        title="New registrations"
        description="People who signed up from the Daily Journal page. Confirm the ones you know so they’re expected to journal; decline anyone who isn’t part of the ministry."
      />

      {result.total === 0 ? (
        <EmptyState icon={UserCheck} title="No one is waiting" description="New sign-ups from the journal page will appear here." />
      ) : (
        <>
          <ul className="space-y-3">
            {result.items.map((item) => (
              <li key={item.personId} className="flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="space-y-1 text-sm">
                  <Link href={`/app/people/${item.personId}`} className="text-base font-semibold hover:text-brand-deep hover:underline">
                    {item.name}
                  </Link>
                  <p className="text-muted">
                    {item.leaderName ? `Chose ${item.leaderName} as their leader` : 'No leader chosen'} · registered{' '}
                    {formatDateTime(item.registeredAt, timezone)}
                  </p>
                  <p className="tabular text-muted">
                    {item.phone ?? 'No mobile'}
                    {item.birthYear ? ` · born ${item.birthYear}` : ''}
                    {item.guardianName ? ` · guardian: ${item.guardianName}` : ''}
                  </p>
                  {item.possibleDuplicates > 0 && (
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone="amber">May already be in the directory</Badge>
                      {canReviewDuplicates && (
                        <Link href="/app/people/review" className="text-brand-deep hover:underline">
                          Review duplicates
                        </Link>
                      )}
                    </p>
                  )}
                </div>
                <DecideRegistration personId={item.personId} name={item.name} />
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/app/people/registrations" params={{}} />
        </>
      )}
    </div>
  );
}
