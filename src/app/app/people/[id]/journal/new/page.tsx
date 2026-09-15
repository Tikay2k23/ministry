import { CircleCheckBig } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDayLabel } from '@/components/journal/journal-status';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getPublishedForm, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { getPersonJournalSummary } from '@/server/modules/journal/journal-portal.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ProxyJournalForm } from './proxy-journal-form';

export const metadata: Metadata = { title: 'Record a journal' };

/** A leader enters a journal the person shared by phone, on paper or in person (FR-JRN-14). */
export default async function ProxyJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();
  const db = getDb();

  let summary;
  try {
    summary = await getPersonJournalSummary(db, ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (!summary.canProxy) notFound();
  const form = await getPublishedForm(db, JOURNAL_FORM_KEY);
  if (!form) notFound();

  // Today and the seven days before it, newest first.
  const dates = summary.days
    .slice(-8)
    .reverse()
    .map((d, i) => ({
      date: d.date,
      label: i === 0 ? `Today · ${formatDayLabel(d.date, 'short')}` : i === 1 ? `Yesterday · ${formatDayLabel(d.date, 'short')}` : formatDayLabel(d.date),
      received: d.hasEntry,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/app/people/${id}`, label: summary.person.name }}
        title="Record a journal"
        description={`For when ${summary.person.firstName} shares their journal by phone, on paper or in person. It will show as entered by you.`}
      />
      {dates.every((d) => d.received) ? (
        <EmptyState
          icon={CircleCheckBig}
          title="Everything is in"
          description={`${summary.person.firstName}’s journals for the last week have all been received.`}
        />
      ) : (
        <div className="max-w-2xl rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <ProxyJournalForm personId={id} versionId={form.versionId} fields={form.fields} dates={dates} />
        </div>
      )}
    </div>
  );
}
