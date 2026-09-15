import { Network } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { listTreeRoots } from '@/server/modules/hierarchy/hierarchy.queries';
import { listLeaderChangeRequests } from '@/server/modules/hierarchy/leader-change.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { TreeExplorer } from './tree-explorer';

export const metadata: Metadata = { title: 'Leadership' };

export default async function LeadershipPage() {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'hierarchy.view')) notFound();
  const db = getDb();

  const [roots, requests] = await Promise.all([
    listTreeRoots(db, ctx),
    hasPermission(ctx, 'people.view') ? listLeaderChangeRequests(db, ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leadership"
        description="Who disciples whom. Expand a leader to see their group."
        actions={
          <Button asChild variant="secondary">
            <Link href="/app/leadership/requests">
              Leader change requests{requests.length > 0 ? ` (${requests.length})` : ''}
            </Link>
          </Button>
        }
      />
      {roots.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No leadership structure yet"
          description="Import your people with their leaders, or place your first leaders from their profiles."
          action={
            hasGlobal(ctx, 'import.manage') ? (
              <Button asChild>
                <Link href="/app/people/import">Import people</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TreeExplorer roots={roots} />
      )}
    </div>
  );
}
