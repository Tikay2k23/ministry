import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { SectionCard } from '@/components/portal/section-card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { formatClockTime } from '@/lib/time-range';
import { isAppError } from '@/server/errors';
import { formatMinutes, ROTATION_LABELS } from '@/server/modules/devotional/devotional.schemas';
import { gatheringTypeCreationOptions, getGatheringTypeSetup } from '@/server/modules/devotional/gathering-types.service';
import { listServingRoles } from '@/server/modules/devotional/serving-roles.service';
import { listWorshipTeams } from '@/server/modules/devotional/teams.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { shortDate } from '../../schedule-rule';
import {
  AddScheduleForm,
  AppointCoordinatorForm,
  EndScheduleButton,
  GatheringTypeDetailsForm,
  OneOffGatheringForm,
  RemoveCoordinatorButton,
  RosterTemplateEditor,
} from './type-setup-forms';

export const metadata: Metadata = { title: 'Gathering setup' };

/** One kind of gathering (docs/04 A21): schedules and rotation, roster template, one-off gatherings, coordinators. */
export default async function GatheringTypeSetupPage({ params }: { params: Promise<{ typeId: string }> }) {
  const { typeId } = await params;
  if (!z.uuid().safeParse(typeId).success) notFound();
  const { ctx } = await requirePortal();
  const db = getDb();

  let setup: Awaited<ReturnType<typeof getGatheringTypeSetup>>;
  try {
    setup = await getGatheringTypeSetup(db, ctx, typeId);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { type, can } = setup;
  const [roles, teams, creation] = await Promise.all([listServingRoles(db, ctx), listWorshipTeams(db, ctx), gatheringTypeCreationOptions(db, ctx)]);
  const teamOptions = teams.map((team) => ({ id: team.id, name: team.name }));
  const activeRoles = roles.filter((role) => role.isActive).map((role) => ({ id: role.id, name: role.name }));
  // Managers who place gatherings in ministries choose among theirs; everyone else keeps the ministry as it is.
  const ministryChoices = creation.canCreate
    ? [
        ...creation.ministries,
        ...(type.ministryId && !creation.ministries.some((m) => m.id === type.ministryId) ? [{ id: type.ministryId, name: type.ministryName ?? 'Current ministry' }] : []),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/devotional/setup', label: 'Setup' }}
        title={type.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {!type.isActive && <Badge tone="slate">Not in use</Badge>}
            {formatClockTime(type.defaultStartTime)} for {formatMinutes(type.defaultDurationMinutes)}
            {type.ministryName ? ` · ${type.ministryName}` : ''}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* min-w-0: the roster template scrolls inside its card on a phone instead of widening the page. */}
        <div className="min-w-0 space-y-6">
          <SectionCard
            title="Schedules"
            description="How often it happens and which team serves when. Gatherings are created ahead; once one exists, the schedule never changes it."
          >
            {setup.schedules.length === 0 ? (
              <p className="text-sm text-muted">No schedule yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {setup.schedules.map((schedule) => (
                  <li key={schedule.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="space-y-0.5">
                      <p className="font-medium">{schedule.name}</p>
                      <p className="text-sm">{schedule.description}</p>
                      <p className="text-sm text-muted">
                        {schedule.teams.length === 0
                          ? 'No team'
                          : schedule.rotationMode === 'none'
                            ? schedule.teams[0]!.name
                            : `${ROTATION_LABELS[schedule.rotationMode]}: ${schedule.teams.map((t) => t.name).join(' → ')}`}
                      </p>
                      <p className="text-sm text-muted">
                        {schedule.effectiveTo ? `${shortDate(schedule.effectiveFrom)} – ${shortDate(schedule.effectiveTo)}` : `From ${shortDate(schedule.effectiveFrom)}`} · created{' '}
                        {schedule.generateDaysAhead} days ahead
                      </p>
                    </div>
                    {schedule.active ? can.manage && <EndScheduleButton scheduleId={schedule.id} name={schedule.name} /> : <Badge tone="slate">Ended</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {can.manage && type.isActive && (
              <AddScheduleForm
                gatheringTypeId={type.id}
                defaultStartTime={type.defaultStartTime}
                defaultDurationMinutes={type.defaultDurationMinutes}
                teams={teamOptions}
                today={setup.today}
              />
            )}
          </SectionCard>

          <SectionCard title="Roster template" description="The roles every gathering needs. Rosters created from now on use it; existing rosters keep their people.">
            {can.manage ? (
              <RosterTemplateEditor gatheringTypeId={type.id} roles={activeRoles} template={setup.template} />
            ) : setup.template.length === 0 ? (
              <p className="text-sm text-muted">No roles yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {setup.template.map((role) => (
                  <li key={role.servingRoleId} className="flex justify-between gap-3 py-2">
                    <span>{role.name}</span>
                    <span className="text-muted">
                      {role.minCount === 0 ? `optional, up to ${role.maxCount}` : role.minCount === role.maxCount ? `${role.minCount} needed` : `${role.minCount}–${role.maxCount}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {can.manage && type.isActive && (
            <SectionCard title="One-off gathering" description="A gathering outside the schedule, such as a prayer and worship night.">
              <OneOffGatheringForm
                gatheringTypeId={type.id}
                teams={teamOptions}
                defaultStartTime={type.defaultStartTime}
                defaultDurationMinutes={type.defaultDurationMinutes}
                today={setup.today}
              />
            </SectionCard>
          )}

          {can.manage && (
            <SectionCard title="Details">
              <GatheringTypeDetailsForm type={type} ministries={ministryChoices} allowNoMinistry={!creation.requiresMinistry || type.ministryId === null} />
            </SectionCard>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <SectionCard title="Worship Coordinators" description="They run this gathering: schedules, rosters, worship teams and substitutes.">
            {setup.coordinators.length === 0 ? (
              <p className="text-sm text-muted">No one is appointed yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {setup.coordinators.map((coordinator) => (
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
            {can.appointCoordinators && <AppointCoordinatorForm gatheringTypeId={type.id} />}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
