import { HandHeart, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { chainCreationOptions, listChains } from '@/server/modules/prayer/chains.service';
import { hasChainScope } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CHAIN_STATUS, CHAIN_TYPE_LABELS } from './labels';

export const metadata: Metadata = { title: 'Prayer Chain' };

/** All prayer chains in the user's scope, with today's coverage (docs/04 A16). */
export default async function PrayerChainsPage() {
  const { ctx } = await requirePortal();
  if (!hasChainScope(ctx, 'prayer.view')) notFound();
  const db = getDb();
  const [chains, options] = await Promise.all([listChains(db, ctx), chainCreationOptions(db, ctx)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prayer Chain"
        description="Covering the ministry in prayer, hour by hour."
        actions={
          options.canCreate && (
            <Button asChild>
              <Link href="/app/prayer/new">
                <Plus aria-hidden className="size-4" /> New chain
              </Link>
            </Button>
          )
        }
      />

      {chains.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title="No prayer chains yet"
          description={options.canCreate ? 'Create one to start scheduling.' : 'Chains you coordinate will appear here.'}
        />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Today</TableHead>
              <TableHead className="text-right">Follow-ups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chains.map((chain) => (
              <TableRow key={chain.id}>
                <TableCell>
                  <Link href={`/app/prayer/${chain.id}`} className="font-medium text-ink hover:text-brand-deep hover:underline">
                    {chain.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {CHAIN_TYPE_LABELS[chain.chainType]}
                    {chain.ministryName ? ` · ${chain.ministryName}` : ''}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge tone={CHAIN_STATUS[chain.status].tone}>{CHAIN_STATUS[chain.status].label}</Badge>
                </TableCell>
                <TableCell className="tabular text-muted">
                  {chain.coverage.total === 0
                    ? 'No slots today'
                    : `${chain.coverage.covered} of ${chain.coverage.total} covered · ${chain.coverage.completed} finished`}
                </TableCell>
                <TableCell className="text-right">
                  {chain.coverage.followUps > 0 ? <Badge tone="amber">{chain.coverage.followUps}</Badge> : <span className="text-muted">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
