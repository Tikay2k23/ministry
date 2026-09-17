import { ChevronRight, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/dates';
import { listQrCodes } from '@/server/modules/public/qr-codes.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CHAIN_STATUS } from '../../prayer/labels';
import { BranchPrintForm } from './branch-print-form';

export const metadata: Metadata = { title: 'QR codes' };

/** QR codes (docs/04 A27): what to print for the journal and the prayer chains, and how often each is scanned. */
export default async function QrCodesPage() {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'links.manage')) notFound();
  const db = getDb();
  const [codes, profile] = await Promise.all([listQrCodes(db, ctx), getSetting(db, 'ministry.profile')]);
  const lastScan = (date: Date | null) => (date ? formatDateTime(date, profile.timezone) : 'Not yet');
  // Leaders by branch, in the service's order (leaders above the branches first).
  const groups: { key: string; label: string; branchPersonId: string | null; leaders: typeof codes.leaders }[] = [];
  for (const leader of codes.leaders) {
    const key = leader.branchPersonId ?? 'above-branches';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: leader.branchName ? `${leader.branchName}’s branch` : 'Above the branches', branchPersonId: leader.branchPersonId, leaders: [] };
      groups.push(group);
    }
    group.leaders.push(leader);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="QR codes"
        description="Printed codes open the journal or a prayer chain with the right leader or chain already chosen. They never show anyone’s information, and a leader’s code can be replaced if it’s lost."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Daily Journal for everyone" description="For the church entrance or a slide: people choose their leader themselves.">
          {codes.general ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                {codes.general.lastScannedAt
                  ? `${codes.general.scans.toLocaleString('en-PH')} scans · last scanned ${lastScan(codes.general.lastScannedAt)}`
                  : 'Not scanned yet'}
              </p>
              <Button asChild variant="secondary" size="sm">
                <Link href="/app/admin/qr/general?layout=poster">
                  <Printer aria-hidden className="size-4" /> Print
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">The general code hasn’t been created. Run the reference-data seed (`npm run db:seed`).</p>
          )}
        </SectionCard>

        <SectionCard title="Cards for a branch" description="One card for every leader in a branch who receives new people, four to an A4 page.">
          {codes.branches.length === 0 ? (
            <p className="text-sm text-muted">No Primary Leaders are placed in the leadership structure yet.</p>
          ) : (
            <BranchPrintForm branches={codes.branches} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Leaders" description="Leaders who receive new people, by branch. A leader can also print their own card from their profile.">
        {codes.leaders.length === 0 ? (
          <p className="text-sm text-muted">No leader is shown in the leader selector yet. Turn it on from a leader’s profile, under their group.</p>
        ) : (
          <div className="divide-y divide-line">
            {groups.map((group) => {
              const printed = group.leaders.filter((l) => l.printed).length;
              const scans = group.leaders.reduce((sum, l) => sum + l.scans, 0);
              return (
                <details key={group.key} className="group py-1">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 hover:bg-ground">
                    <span className="flex items-center gap-2 font-medium">
                      <ChevronRight aria-hidden className="size-4 text-muted transition-transform group-open:rotate-90" />
                      {group.label}
                    </span>
                    <span className="tabular text-sm text-muted">
                      {group.leaders.length === 1 ? '1 leader' : `${group.leaders.length} leaders`} · {printed} printed · {scans.toLocaleString('en-PH')} scans
                    </span>
                  </summary>
                  <div className="space-y-3 pt-2 pb-3">
                    {group.branchPersonId && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/app/admin/qr/branch?personId=${group.branchPersonId}`}>
                          <Printer aria-hidden className="size-4" /> Print this branch’s cards
                        </Link>
                      </Button>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Leader</TableHead>
                          <TableHead>Scans</TableHead>
                          <TableHead>Last scanned</TableHead>
                          <TableHead>
                            <span className="sr-only">Print</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.leaders.map((leader) => (
                          <TableRow key={leader.personId}>
                            <TableCell className="font-medium">{leader.name}</TableCell>
                            <TableCell className="tabular">{leader.printed ? leader.scans.toLocaleString('en-PH') : <span className="text-muted">Not printed</span>}</TableCell>
                            <TableCell className="text-muted">{leader.printed ? lastScan(leader.lastScannedAt) : '—'}</TableCell>
                            <TableCell className="text-right">
                              <Link href={`/app/people/${leader.personId}/qr`} className="text-sm font-medium text-brand-deep hover:underline">
                                Print<span className="sr-only"> {leader.name}’s card</span>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Prayer chains" description="Each chain’s page lets people find their own slot.">
        {codes.chains.length === 0 ? (
          <p className="text-sm text-muted">No prayer chains yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scans</TableHead>
                <TableHead>Last scanned</TableHead>
                <TableHead>
                  <span className="sr-only">Print</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.chains.map((chain) => (
                <TableRow key={chain.id}>
                  <TableCell className="font-medium">{chain.name}</TableCell>
                  <TableCell>
                    <Badge tone={CHAIN_STATUS[chain.status].tone}>{CHAIN_STATUS[chain.status].label}</Badge>
                  </TableCell>
                  <TableCell className="tabular">{chain.url ? chain.scans.toLocaleString('en-PH') : <span className="text-muted">Not printed</span>}</TableCell>
                  <TableCell className="text-muted">{chain.url ? lastScan(chain.lastScannedAt) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/app/prayer/${chain.id}/qr?layout=poster`} className="text-sm font-medium text-brand-deep hover:underline">
                      Print<span className="sr-only"> the {chain.name} poster</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
