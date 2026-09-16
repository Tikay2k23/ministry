import { ArrowLeft, ArrowRight, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';
import { isAppError } from '@/server/errors';
import { getChainBoard } from '@/server/modules/prayer/assignments.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ASSIGNMENT_STATUS, CHAIN_STATUS } from '../labels';
import { AssignButton, AssignmentMenu, ResolveButton, SubstituteButton } from './board-actions';

export const metadata: Metadata = { title: 'Prayer chain' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The day board (docs/04 A17): the slots of one day, who is on them, gaps, and gentle follow-up. */
export default async function ChainBoardPage({ params, searchParams }: { params: Promise<{ chainId: string }>; searchParams: Promise<SearchParams> }) {
  const { chainId } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePortal();

  let board: Awaited<ReturnType<typeof getChainBoard>>;
  try {
    board = await getChainBoard(getDb(), ctx, { chainId, date: first(sp.date) });
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR')) notFound();
    throw error;
  }

  const { chain, summary, can } = board;
  const isToday = board.date === board.today;
  const dayHref = (date: string) => (date === board.today ? `/app/prayer/${chain.id}` : `/app/prayer/${chain.id}?date=${date}`);
  const tiles = [
    { label: 'Slots', value: summary.slots },
    { label: 'Covered', value: summary.covered },
    { label: 'Finished', value: summary.completed },
    { label: 'Still open', value: summary.gaps },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/prayer', label: 'Prayer Chain' }}
        title={chain.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CHAIN_STATUS[chain.status].tone}>{CHAIN_STATUS[chain.status].label}</Badge>
            {formatDayLabel(board.date)}
            {isToday ? ' · today' : ''}
          </span>
        }
        actions={
          (can.manage || can.assign) && (
            <Button asChild variant="secondary">
              <Link href={`/app/prayer/${chain.id}/setup`}>
                <Settings2 aria-hidden className="size-4" /> Schedule & setup
              </Link>
            </Button>
          )
        }
      />

      {chain.status === 'draft' && (
        <Alert tone="info" title="This chain hasn’t started yet">
          Start it from{' '}
          <Link href={`/app/prayer/${chain.id}/setup`} className="font-semibold underline">
            Schedule & setup
          </Link>
          . Its slots are created when it starts.
        </Alert>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Choose a day" className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={dayHref(board.previousDate)} aria-label="Previous day">
              <ArrowLeft aria-hidden className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={dayHref(board.nextDate)} aria-label="Next day">
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
          {!isToday && (
            <Button asChild variant="ghost" size="sm">
              <Link href={dayHref(board.today)}>Today</Link>
            </Button>
          )}
        </nav>
        <form method="get" className="flex items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="date" className="text-xs font-semibold tracking-wider text-muted uppercase">
              Day
            </label>
            <input id="date" name="date" type="date" defaultValue={board.date} className={inputClassName} />
          </div>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="tabular font-display text-3xl font-extrabold">{tile.value}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="slots" className="space-y-3">
          <h2 id="slots" className="text-lg">
            Slots
          </h2>
          {board.slots.length === 0 ? (
            <EmptyState
              title="No slots on this day"
              description={chain.status === 'active' ? 'This day isn’t in the schedule, or its slots haven’t been created yet.' : undefined}
            />
          ) : (
            <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              {board.slots.map((slot) => (
                <li key={slot.id} className={cn('flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start', slot.isNow && 'bg-brand-leaf-tint/60')}>
                  <div className="space-y-1 sm:w-44 sm:shrink-0">
                    <p className={cn('tabular font-medium', slot.isPast ? 'text-muted' : 'text-ink')}>{slot.label}</p>
                    {slot.isNow && <Badge tone="green">Now</Badge>}
                  </div>
                  <div className="flex-1 space-y-2">
                    {slot.assignments.length === 0 && <p className="text-sm text-muted">{slot.isPast ? 'No one was on this slot.' : 'Open'}</p>}
                    {slot.assignments.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                        {a.completedLate && <Badge>Marked late</Badge>}
                        {a.verified && <Badge>Confirmed by coordinator</Badge>}
                        {a.substitute && <Badge>Substitute</Badge>}
                        {a.cannotMakeIt && (a.status === 'scheduled' || a.status === 'confirmed') && <Badge tone="amber">Can’t make it</Badge>}
                        <AssignmentMenu
                          chainId={chain.id}
                          assignment={{ id: a.id, name: a.name, status: a.status, hasReport: a.hasReport }}
                          slotLabel={`${formatDayLabel(board.date, 'short')}, ${slot.label}`}
                          slotStarted={slot.isNow || slot.isPast}
                          canAssign={can.assign}
                        />
                      </div>
                    ))}
                    {can.assign && !slot.isPast && slot.placesLeft > 0 && chain.status !== 'ended' && (
                      <AssignButton chainId={chain.id} slotId={slot.id} slotLabel={`${formatDayLabel(board.date, 'short')}, ${slot.label}`} />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-6">
          <section aria-labelledby="follow-ups" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h2 id="follow-ups" className="text-lg">
              Needs follow-up
            </h2>
            {board.followUps.length === 0 ? (
              <p className="text-sm text-muted">Nothing is waiting.</p>
            ) : (
              <ul className="divide-y divide-line">
                {board.followUps.map((item) => (
                  <li key={item.assignmentId} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted">
                      {item.slotLabel}
                      {item.checkedIn ? ' · checked in, but didn’t mark finished' : ''}
                    </p>
                    {item.phone && (
                      <a href={`tel:${item.phone.replace(/\s/g, '')}`} className="text-sm text-brand-deep underline">
                        {item.phone}
                      </a>
                    )}
                    {can.resolve && (
                      <div className="pt-1">
                        <ResolveButton assignmentId={item.assignmentId} personName={item.name} slotLabel={item.slotLabel} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {board.needsSubstitute.length > 0 && (
            <section aria-labelledby="substitutes" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <h2 id="substitutes" className="text-lg">
                Needs a substitute
              </h2>
              <ul className="divide-y divide-line">
                {board.needsSubstitute.map((item) => (
                  <li key={item.assignmentId} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted">{item.slotLabel}</p>
                    {can.assign && (
                      <div className="pt-1">
                        <SubstituteButton chainId={chain.id} assignmentId={item.assignmentId} personName={item.name} slotLabel={item.slotLabel} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
