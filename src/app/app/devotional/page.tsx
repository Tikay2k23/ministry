import { ChevronLeft, ChevronRight, Music } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref } from '@/components/ui/pagination';
import { getDevotionalCalendar } from '@/server/modules/devotional/calendar.service';
import { canViewWorshipTeams } from '@/server/modules/devotional/teams.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DevotionalTabs } from './devotional-tabs';
import { PublishRostersButton } from './publish-week-button';
import { ReplyCounts } from './reply-counts';

export const metadata: Metadata = { title: 'Devotional' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The devotional calendar (docs/04 A19): a week of gatherings with their team, replies and open roles. */
export default async function DevotionalCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'devotional.view')) notFound();
  const sp = await searchParams;
  const calendar = await getDevotionalCalendar(getDb(), ctx, { week: first(sp.week), gatheringTypeId: first(sp.type), attention: first(sp.attention) });
  const weekHref = (week: string) =>
    buildHref('/app/devotional', { week, type: calendar.filters.gatheringTypeId ?? undefined, attention: calendar.filters.attention ? '1' : undefined });
  const total = calendar.days.reduce((sum, day) => sum + day.gatherings.length, 0);
  const thisWeek = calendar.days.some((day) => day.isToday);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devotional"
        description="Who serves when, and who has replied."
        actions={calendar.unpublishedIds.length > 0 && <PublishRostersButton gatheringIds={calendar.unpublishedIds} label="Publish this week" />}
      />
      <DevotionalTabs teams={canViewWorshipTeams(ctx)} setup={calendar.can.setup} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Choose a week" className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={weekHref(calendar.previousWeek)} aria-label="Previous week">
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={weekHref(calendar.nextWeek)} aria-label="Next week">
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </Button>
          <p className="font-medium">
            {formatDayLabel(calendar.weekStart, 'short')} – {formatDayLabel(calendar.weekEnd, 'short')}
          </p>
          {!thisWeek && (
            <Button asChild variant="ghost" size="sm">
              <Link href={weekHref(calendar.today)}>This week</Link>
            </Button>
          )}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="week" value={calendar.weekStart} />
          {calendar.types.length > 1 && (
            <div className="space-y-1">
              <label htmlFor="type" className="text-xs font-semibold tracking-wider text-muted uppercase">
                Gathering
              </label>
              <select id="type" name="type" defaultValue={calendar.filters.gatheringTypeId ?? ''} className={inputClassName}>
                <option value="">All gatherings</option>
                {calendar.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="attention" value="1" defaultChecked={calendar.filters.attention} className="size-4 accent-brand-deep" />
            Needs attention only
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </div>

      {total === 0 ? (
        calendar.filters.attention ? (
          <EmptyState icon={Music} title="Nothing needs attention this week" description="Every roster has its people and nobody has said they can’t serve." />
        ) : (
          <EmptyState
            icon={Music}
            title="No devotionals scheduled"
            description="Set up a schedule to generate them."
            action={
              calendar.can.setup && (
                <Button asChild variant="secondary">
                  <Link href="/app/devotional/setup">Open setup</Link>
                </Button>
              )
            }
          />
        )
      ) : (
        <ol className="space-y-5">
          {calendar.days.map((day) => (
            <li key={day.date} className="space-y-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                {formatDayLabel(day.date)}
                {day.isToday && <Badge tone="green">Today</Badge>}
              </h2>
              {day.gatherings.length === 0 ? (
                <p className="text-sm text-muted">No gatherings</p>
              ) : (
                <ul className="space-y-2">
                  {day.gatherings.map((gathering) => (
                    <li key={gathering.id}>
                      <Link
                        href={`/app/devotional/${gathering.id}`}
                        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-deep/40 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-0.5">
                          <p className="font-medium">{gathering.name}</p>
                          <p className="text-sm text-muted">
                            {gathering.timeLabel}
                            {gathering.teamName ? ` · ${gathering.teamName}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {gathering.status === 'cancelled' ? (
                            <Badge tone="slate">Cancelled</Badge>
                          ) : (
                            <>
                              <ReplyCounts confirmed={gathering.confirmed} pending={gathering.pending} declined={gathering.declined} />
                              {gathering.openRequired > 0 && <Badge tone="amber">{gathering.openRequired === 1 ? '1 role open' : `${gathering.openRequired} roles open`}</Badge>}
                              {!gathering.published && <Badge>Draft</Badge>}
                            </>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
