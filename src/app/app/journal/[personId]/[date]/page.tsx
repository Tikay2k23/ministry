import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EXCUSE_LABEL, formatClock, formatDayLabel, JournalStatus } from '@/components/journal/journal-status';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/dates';
import { isAppError } from '@/server/errors';
import { getJournalEntry } from '@/server/modules/journal/journal-portal.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ExcuseDay } from './excuse-day';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Journal' };

export default async function JournalEntryPage({ params }: { params: Promise<{ personId: string; date: string }> }) {
  const { personId, date } = await params;
  const { ctx, sensitiveLocked } = await requirePortal();
  const db = getDb();

  let view;
  try {
    view = await getJournalEntry(db, ctx, { personId, date });
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR')) notFound();
    throw error;
  }
  const { timezone } = await getSetting(db, 'ministry.profile');
  const { entry } = view;
  const manualExcuse = view.excuseReason === 'leader_excused' || view.excuseReason === 'admin_excused';
  const canChangeExcuse = view.canExcuse && (view.status === 'pending' || view.status === 'missed' || (view.status === 'excused' && manualExcuse));
  const myReview = entry?.reviews.find((r) => r.mine);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/app/journal?date=${date}`, label: 'Daily Journal' }}
        title={view.person.name}
        description={formatDayLabel(date)}
        actions={
          <Link href={`/app/people/${personId}`} className="text-sm text-brand-deep hover:underline">
            View profile
          </Link>
        }
      />

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="space-y-1">
          <JournalStatus status={view.status} className="text-base" />
          <p className="text-sm text-muted">
            {entry
              ? [
                  `Received ${formatClock(entry.receivedAt, timezone)}`,
                  entry.lastEditedAt ? `edited ${formatClock(entry.lastEditedAt, timezone)}` : null,
                  entry.byProxy ? 'entered by a leader' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : view.excuseReason
                ? EXCUSE_LABEL[view.excuseReason]
                : view.status === 'pending'
                  ? 'The day is still open.'
                  : view.status === 'missed'
                    ? 'No journal came in for this day.'
                    : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.reviewStatus === 'reviewed' && <Badge tone="green">Reviewed</Badge>}
          {view.reviewStatus === 'awaiting' && <Badge tone="slate">Awaiting review</Badge>}
          {view.careStatus === 'needs_follow_up' && <Badge tone="amber">Follow-up open</Badge>}
          {canChangeExcuse && !entry && <ExcuseDay personId={personId} date={date} excused={view.status === 'excused'} />}
        </div>
      </section>

      {entry && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-base">Journal</h2>
            {entry.purged ? (
              <p className="text-sm text-muted">The answers for this day were removed under the ministry’s retention policy.</p>
            ) : entry.answers.length > 0 ? (
              <dl className="space-y-5">
                {entry.answers.map((answer) => (
                  <div key={answer.key} className="space-y-1">
                    <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted">
                      {answer.label}
                      {answer.sensitivity === 'restricted' && <Badge tone="slate">Leader &amp; pastors</Badge>}
                      {answer.sensitivity === 'confidential' && <Badge tone="slate">Pastors only</Badge>}
                    </dt>
                    <dd className="whitespace-pre-wrap text-[15px] leading-relaxed">{answer.text}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="flex items-start gap-2 text-sm text-muted">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                {sensitiveLocked
                  ? 'Journal answers unlock once you turn on two-step verification.'
                  : 'The answers in this journal are kept for the person’s direct leader and pastors.'}
              </p>
            )}
            {entry.answers.length > 0 && entry.hiddenCount > 0 && (
              <p className="flex items-center gap-2 border-t border-line pt-4 text-sm text-muted">
                <Lock aria-hidden className="size-4 shrink-0" />
                {entry.hiddenCount === 1 ? '1 more answer is' : `${entry.hiddenCount} more answers are`} private to pastors.
              </p>
            )}
            {sensitiveLocked && entry.answers.length === 0 && (
              <Alert tone="warning">
                <Link href="/app/account/security" className="font-semibold underline">
                  Turn on two-step verification
                </Link>{' '}
                to read journal answers.
              </Alert>
            )}
          </section>

          <div className="space-y-6">
            {entry.reviews.length > 0 && (
              <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-base">Reviews</h2>
                <ul className="space-y-3 text-sm">
                  {entry.reviews.map((r, i) => (
                    <li key={i} className="space-y-1 border-l-2 border-line pl-3">
                      <p>
                        <span className="font-medium">{r.reviewerName}</span>{' '}
                        <span className="text-muted">· {formatDateTime(r.reviewedAt, timezone)}</span>
                      </p>
                      {r.comment && <p className="whitespace-pre-wrap">{r.comment}</p>}
                      {r.flaggedFollowUp && <Badge tone="amber">Follow-up requested</Badge>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {view.canReview && (
              <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-base">{myReview ? 'Your review' : 'Review'}</h2>
                <ReviewForm
                  entryId={entry.id}
                  personId={personId}
                  personFirstName={view.person.name.split(' ')[0] ?? view.person.name}
                  existingComment={myReview?.comment ?? null}
                  alreadyReviewed={Boolean(myReview)}
                />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
