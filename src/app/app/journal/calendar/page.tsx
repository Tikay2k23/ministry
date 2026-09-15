import { CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { addDays, localDate } from '@/server/modules/journal/journal-dates';
import { listCalendarDays } from '@/server/modules/journal/journal-calendar.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CalendarDayForm, RemoveDayButton } from './calendar-controls';

export const metadata: Metadata = { title: 'Rest days' };

const KIND_LABEL: Record<string, string> = { journal_rest_day: 'Journal rest day', holiday: 'Holiday', special: 'Special day' };

export default async function JournalCalendarPage() {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'journal.status.view')) notFound();
  const db = getDb();
  const { timezone } = await getSetting(db, 'ministry.profile');
  const today = localDate(ctx.now, timezone);
  const days = await listCalendarDays(db, ctx, { from: addDays(today, -30), to: addDays(today, 365) });
  const canManage = hasGlobal(ctx, 'journal.settings.manage');
  const upcoming = days.filter((d) => d.day >= today);
  const recent = days.filter((d) => d.day < today).reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/journal', label: 'Daily Journal' }}
        title="Rest days"
        description="Days when no one is expected to journal — retreats, holidays, the church anniversary. For one person’s leave or sickness, add a pause on their profile instead."
      />

      {canManage && <CalendarDayForm today={today} />}

      <section className="space-y-3">
        <h2 className="text-lg">Coming up</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No rest days planned" description={canManage ? 'Add one above.' : undefined} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {upcoming.map((d) => (
              <li key={d.day} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {formatDayLabel(d.day)}
                    {d.day === today && <span className="ml-2 text-muted">(today)</span>}
                  </p>
                  <p className="text-muted">
                    {KIND_LABEL[d.kind] ?? d.kind}
                    {d.note ? ` · ${d.note}` : ''}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {!d.excusesJournal && <Badge>Journal still expected</Badge>}
                  {canManage && <RemoveDayButton day={d.day} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg">Past 30 days</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-sm text-muted">
            {recent.map((d) => (
              <li key={d.day} className="px-4 py-3">
                {formatDayLabel(d.day)} · {KIND_LABEL[d.kind] ?? d.kind}
                {d.note ? ` · ${d.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
