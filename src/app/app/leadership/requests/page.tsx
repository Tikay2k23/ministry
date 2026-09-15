import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/dates';
import { listLeaderChangeRequests } from '@/server/modules/hierarchy/leader-change.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DecideButtons } from './decide-buttons';

export const metadata: Metadata = { title: 'Leader change requests' };

const STATUSES = [
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Declined' },
  { value: 'superseded', label: 'Closed' },
] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'people.view')) notFound();
  const db = getDb();
  const { status: rawStatus } = await searchParams;
  const status = STATUSES.find((s) => s.value === rawStatus)?.value ?? 'pending';
  const [requests, profile] = await Promise.all([listLeaderChangeRequests(db, ctx, { status }), getSetting(db, 'ministry.profile')]);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/leadership', label: 'Leadership' }}
        title="Leader change requests"
        description="Requests to move someone into a different group. The receiving leader or a Primary Leader decides."
      />

      <nav aria-label="Request status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={s.value === 'pending' ? '/app/leadership/requests' : `/app/leadership/requests?status=${s.value}`}
            aria-current={status === s.value ? 'page' : undefined}
            className={
              status === s.value
                ? 'rounded-full bg-brand-deep px-3 py-1 text-sm font-medium text-white'
                : 'rounded-full border border-line-strong px-3 py-1 text-sm hover:bg-ground'
            }
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {requests.length === 0 ? (
        <EmptyState icon={Inbox} title={status === 'pending' ? 'No requests waiting' : 'Nothing here yet'} />
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">
                    {r.personViewable ? (
                      <Link href={`/app/people/${r.personId}`} className="hover:underline">
                        {r.personName}
                      </Link>
                    ) : (
                      r.personName
                    )}
                    <span className="font-normal text-muted"> · from {r.fromLeaderName ?? 'no leader'} to </span>
                    {r.toLeaderName}
                    {r.incoming && (
                      <Badge tone="green" className="ml-2">
                        Into your group
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    Requested {formatDateTime(r.createdAt, profile.timezone)}
                    {r.requestedBy ? ` by ${r.requestedBy}` : ''}
                  </p>
                  {r.reason && <p className="text-sm">“{r.reason}”</p>}
                  {r.decisionNote && <p className="text-sm text-muted">Decision note: “{r.decisionNote}”</p>}
                </div>
                {status === 'pending' && r.decidable && <DecideButtons requestId={r.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
