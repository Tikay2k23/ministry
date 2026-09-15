import { CopyCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { listDuplicateCandidates } from '@/server/modules/people/people.queries';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DismissButton } from './dismiss-button';

export const metadata: Metadata = { title: 'Possible duplicates' };

const REASON_LABEL: Record<string, string> = { same_phone: 'Same mobile', same_email: 'Same email', similar_name: 'Similar name' };

export default async function ReviewPage() {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'people.merge')) notFound();
  const candidates = await listDuplicateCandidates(getDb(), ctx);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/people', label: 'People' }}
        title="Possible duplicates"
        description="Records that may be the same person. Nothing is merged automatically. A merge tool is planned (V1); until then, dismiss false alarms or correct records by hand."
      />
      {candidates.length === 0 ? (
        <EmptyState icon={CopyCheck} title="Nothing to review" description="New possible duplicates appear here when people are added or imported." />
      ) : (
        <ul className="space-y-4">
          {candidates.map((c) => (
            <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.reasons.map((r) => REASON_LABEL[r] ?? r).join(' · ')}</p>
                <DismissButton candidateId={c.id} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[c.a, c.b].map((p) => (
                  <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
                    <Link href={`/app/people/${p.id}`} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                    <p className="tabular text-xs text-muted">{p.personCode}</p>
                    <p className="tabular mt-2 text-muted">{p.phone ?? 'No mobile'}</p>
                    <p className="text-muted">{p.email ?? 'No email'}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
