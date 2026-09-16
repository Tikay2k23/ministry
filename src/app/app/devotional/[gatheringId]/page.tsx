import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { ASSIGNMENT_STATUS_LABELS } from '@/server/modules/devotional/devotional.schemas';
import { getGatheringRoster } from '@/server/modules/devotional/roster.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ASSIGNMENT_TONE, GATHERING_STATUS, neededLabel } from '../labels';
import { AssignButton, AssignmentMenu, GatheringDetailsForm, RosterHeaderActions } from './roster-actions';

export const metadata: Metadata = { title: 'Roster' };

/** One gathering's roster (docs/04 A20): roles, people, replies, warnings and the coordinator's actions. */
export default async function RosterPage({ params }: { params: Promise<{ gatheringId: string }> }) {
  const { gatheringId } = await params;
  const { ctx } = await requirePortal();

  let roster: Awaited<ReturnType<typeof getGatheringRoster>>;
  try {
    roster = await getGatheringRoster(getDb(), ctx, { gatheringId });
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR')) notFound();
    throw error;
  }
  const { gathering, summary, can } = roster;
  const tiles = [
    { label: 'Confirmed', value: summary.confirmed },
    { label: 'Waiting for a reply', value: summary.pending },
    { label: 'Can’t serve', value: summary.declined },
    { label: 'Roles still open', value: summary.openRequired },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/app/devotional?week=${gathering.occursOn}`, label: 'Devotional' }}
        title={gathering.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {gathering.status !== 'scheduled' && <Badge tone={GATHERING_STATUS[gathering.status].tone}>{GATHERING_STATUS[gathering.status].label}</Badge>}
            {gathering.status === 'scheduled' && <Badge tone={gathering.published ? 'green' : 'neutral'}>{gathering.published ? 'Published' : 'Draft'}</Badge>}
            {gathering.dateLabel} · {gathering.timeLabel}
            {gathering.teamName ? ` · ${gathering.teamName}` : ''}
          </span>
        }
        actions={can.manage && <RosterHeaderActions gatheringId={gathering.id} canPublish={can.publish} canRebuild={can.rebuild} />}
      />

      {gathering.status === 'cancelled' && (
        <Alert tone="warning" title="This gathering was cancelled">
          {gathering.cancelReason}
        </Alert>
      )}
      {gathering.status === 'scheduled' && !gathering.published && !gathering.isOver && (
        <Alert tone="info" title="Draft roster">
          Nobody has been told yet. When the roster looks right, publish it to send everyone their personal link.
        </Alert>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="tabular font-display text-3xl font-extrabold">{tile.value}</p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="roster" className="space-y-3">
        <h2 id="roster" className="text-lg">
          Roster
        </h2>
        {roster.roles.length === 0 ? (
          <EmptyState title="No roles on this roster" description="Add roles to this gathering’s roster template in Setup." />
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {roster.roles.map((role) => (
              <li key={role.servingRoleId} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {role.name} <span className="text-sm font-normal text-muted">{neededLabel(role)}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    {role.open > 0 && <Badge tone="amber">{role.open} open</Badge>}
                    {can.manage && <AssignButton gatheringId={gathering.id} servingRoleId={role.servingRoleId} roleName={role.name} />}
                  </div>
                </div>
                {role.assignments.length === 0 ? (
                  <p className="text-sm text-muted">No one yet</p>
                ) : (
                  <ul className="space-y-2">
                    {role.assignments.map((assignment) => (
                      <li key={assignment.id} className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span>{assignment.name}</span>
                            <Badge tone={ASSIGNMENT_TONE[assignment.status]}>{ASSIGNMENT_STATUS_LABELS[assignment.status]}</Badge>
                            {assignment.substituteFor && <Badge>In place of {assignment.substituteFor}</Badge>}
                            {assignment.warnings.map((warning) => (
                              <Badge key={warning.code} tone="amber">
                                {warning.message}
                              </Badge>
                            ))}
                          </p>
                          {assignment.responseNote && <p className="text-sm text-muted">“{assignment.responseNote}”</p>}
                          {assignment.phone && assignment.status !== 'confirmed' && (
                            <a href={`tel:${assignment.phone.replace(/\s/g, '')}`} className="text-sm text-brand-deep underline">
                              {assignment.phone}
                            </a>
                          )}
                        </div>
                        {can.manage && (
                          <AssignmentMenu
                            gatheringId={gathering.id}
                            assignment={{ id: assignment.id, name: assignment.name, status: assignment.status }}
                            roleName={role.name}
                            published={gathering.published}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {can.manage ? (
        <SectionCard title="Title and notes">
          <GatheringDetailsForm gatheringId={gathering.id} title={gathering.title} notes={gathering.notes} typeName={gathering.typeName} />
        </SectionCard>
      ) : (
        gathering.notes && (
          <SectionCard title="Notes">
            <p className="whitespace-pre-line">{gathering.notes}</p>
          </SectionCard>
        )
      )}
    </div>
  );
}
