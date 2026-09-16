import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { z } from 'zod';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PrayerChainStatus } from '@/server/db/enums';
import { isAppError } from '@/server/errors';
import { chainCreationOptions, getChainDetail } from '@/server/modules/prayer/chains.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CHAIN_STATUS } from '../../labels';
import { SectionCard } from '../../section-card';
import {
  AddCommitmentForm,
  AddScheduleForm,
  AppointCoordinatorForm,
  ChainStatusActions,
  CopyLinkButton,
  EditChainForm,
  EndCommitmentButton,
  EndScheduleButton,
  RemoveCoordinatorButton,
} from './setup-forms';

export const metadata: Metadata = { title: 'Schedule & setup' };

const STATUS_TEXT: Record<PrayerChainStatus, string> = {
  draft: 'Not started yet. Its slots are created when it starts.',
  active: 'Running. Slots are created ahead as the days go by.',
  paused: 'Paused. No new slots are created until you resume it.',
  ended: 'Ended. Its history stays for reports.',
};

const dateRange = (from: string, to: string | null) =>
  to ? `${formatDayLabel(from, 'short')} – ${formatDayLabel(to, 'short')}` : `From ${formatDayLabel(from, 'short')}`;

/** A chain's schedules, standing commitments, public page, coordinators and details (docs/04 A18). */
export default async function ChainSetupPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await params;
  if (!z.uuid().safeParse(chainId).success) notFound();
  const { ctx } = await requirePortal();
  const db = getDb();

  let detail: Awaited<ReturnType<typeof getChainDetail>>;
  try {
    detail = await getChainDetail(db, ctx, chainId);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const { chain, can } = detail;
  const running = chain.status !== 'ended';
  const today = detail.coverage.today;
  const options = can.manage ? await chainCreationOptions(db, ctx) : null;
  // Managers who place chains in ministries choose among theirs; everyone else keeps the chain where it is.
  const ministryChoices = options?.canCreate
    ? [
        ...options.ministries,
        ...(chain.ministryId && !options.ministries.some((m) => m.id === chain.ministryId)
          ? [{ id: chain.ministryId, name: chain.ministryName ?? 'Current ministry' }]
          : []),
      ]
    : [];
  // Generated server-side from our own URL; near-black on white scans most reliably.
  const qrSvg = await QRCode.toString(detail.publicUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2328', light: '#ffffff' } });

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/app/prayer/${chain.id}`, label: chain.name }}
        title="Schedule & setup"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CHAIN_STATUS[chain.status].tone}>{CHAIN_STATUS[chain.status].label}</Badge>
            {chain.name}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <SectionCard title="Schedules" description="The pattern of prayer slots. Slots are created a set number of days ahead.">
            {detail.schedules.length === 0 ? (
              <p className="text-sm text-muted">No schedule yet. Add one before starting the chain.</p>
            ) : (
              <ul className="divide-y divide-line">
                {detail.schedules.map((schedule) => (
                  <li key={schedule.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="space-y-0.5">
                      <p className="font-medium">{schedule.description}</p>
                      <p className="text-sm text-muted">
                        {schedule.capacity === 1 ? 'One person per slot' : `${schedule.capacity} people per slot`} ·{' '}
                        {dateRange(schedule.effectiveFrom, schedule.effectiveTo)} · created {schedule.generateDaysAhead} days ahead
                      </p>
                    </div>
                    {!schedule.active ? (
                      <Badge tone="slate">Ended</Badge>
                    ) : (
                      can.manage && running && <EndScheduleButton scheduleId={schedule.id} description={schedule.description} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can.manage && running && <AddScheduleForm chainId={chain.id} timezone={chain.timezone} today={today} />}
          </SectionCard>

          <SectionCard title="Standing commitments" description="People who pray at the same time every week. They are put on those slots automatically.">
            {detail.commitments.length === 0 ? (
              <p className="text-sm text-muted">No standing commitments yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Person</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Dates</TableHead>
                    {can.assign && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.commitments.map((commitment) => (
                    <TableRow key={commitment.id}>
                      <TableCell className="font-medium">{commitment.personName}</TableCell>
                      <TableCell>{commitment.pattern}</TableCell>
                      <TableCell className="text-muted">{dateRange(commitment.effectiveFrom, commitment.effectiveTo)}</TableCell>
                      {can.assign && (
                        <TableCell className="text-right">
                          <EndCommitmentButton commitmentId={commitment.id} personName={commitment.personName} pattern={commitment.pattern} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {can.assign && running && <AddCommitmentForm chainId={chain.id} timezone={chain.timezone} today={today} />}
          </SectionCard>

          {can.manage && options && (
            <SectionCard title="Chain details">
              <EditChainForm
                chain={{
                  id: chain.id,
                  name: chain.name,
                  description: chain.description,
                  chainType: chain.chainType,
                  timezone: chain.timezone,
                  ministryId: chain.ministryId,
                  startsOn: chain.startsOn,
                  endsOn: chain.endsOn,
                  graceMinutes: chain.graceMinutes,
                  checkinOpensMinutes: chain.checkinOpensMinutes,
                  requireCheckin: chain.requireCheckin,
                  showNamesPublicly: chain.showNamesPublicly,
                  collectsReports: chain.collectsReports,
                }}
                ministries={ministryChoices}
                allowNoMinistry={!options.requiresMinistry || chain.ministryId === null}
                fixedMinistryName={ministryChoices.length === 0 ? chain.ministryName : undefined}
              />
            </SectionCard>
          )}
        </div>

        <div className="space-y-6">
          <SectionCard title="Status" description={STATUS_TEXT[chain.status]}>
            {can.manage ? <ChainStatusActions chainId={chain.id} status={chain.status} /> : null}
          </SectionCard>

          <SectionCard title="Public page" description="Share this QR code or link. Anyone can see the chain and find their own slot; it never shows contact details.">
            <div
              className="mx-auto w-44 rounded-xl border border-line bg-white p-3 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="tabular text-center text-xs break-all text-muted">{detail.publicUrl.replace(/^https?:\/\//, '')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <CopyLinkButton url={detail.publicUrl} />
              <Button asChild variant="secondary" size="sm">
                <a href={detail.publicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden className="size-4" /> Open the public page
                </a>
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Coordinators" description="They run this chain: its schedule, assignments and gentle follow-up.">
            {detail.coordinators.length === 0 ? (
              <p className="text-sm text-muted">No one is appointed to this chain yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {detail.coordinators.map((coordinator) => (
                  <li key={coordinator.assignmentId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{coordinator.name}</p>
                      {can.appointCoordinators && <p className="truncate text-sm text-muted">{coordinator.email}</p>}
                    </div>
                    {can.appointCoordinators && <RemoveCoordinatorButton assignmentId={coordinator.assignmentId} name={coordinator.name} />}
                  </li>
                ))}
              </ul>
            )}
            {can.appointCoordinators && running && <AppointCoordinatorForm chainId={chain.id} />}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
