import { UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ministryTimeZone } from '@/server/modules/devotional/common';
import { listGatheringTypes } from '@/server/modules/devotional/gathering-types.service';
import { listServingRoles } from '@/server/modules/devotional/serving-roles.service';
import { canViewWorshipTeams, listWorshipTeams, worshipTeamOptions } from '@/server/modules/devotional/teams.service';
import { localDate } from '@/server/modules/journal/journal-dates';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DevotionalTabs } from '../devotional-tabs';
import { AddMemberButton, AwayChip, CreateTeamForm, MemberMenu } from './team-actions';

export const metadata: Metadata = { title: 'Worship teams' };

/** Worship teams (docs/04 A21, docs/05 W8 step 2): members, the roles they usually play, and days they're away. */
export default async function WorshipTeamsPage() {
  const { ctx } = await requirePortal();
  if (!canViewWorshipTeams(ctx)) notFound();
  const db = getDb();
  const [teams, roles, options, types, timeZone] = await Promise.all([
    listWorshipTeams(db, ctx),
    listServingRoles(db, ctx),
    worshipTeamOptions(db, ctx),
    listGatheringTypes(db, ctx),
    ministryTimeZone(db),
  ]);
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const activeRoles = roles.filter((role) => role.isActive).map((role) => ({ id: role.id, name: role.name }));
  const today = localDate(ctx.now, timeZone);
  const canSetup = hasPermission(ctx, 'devotional.teams.manage') || types.some((type) => type.canManage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devotional"
        description="Worship teams, the roles each member usually plays, and the days they’re away."
        actions={options.ministries.length > 0 && <CreateTeamForm ministries={options.ministries} />}
      />
      <DevotionalTabs teams setup={canSetup} />

      {teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No worship teams yet"
          description={
            options.ministries.length > 0
              ? 'Add a team, then its members and the roles they play.'
              : hasPermission(ctx, 'devotional.teams.manage')
                ? 'Worship teams belong to a ministry. Add the ministry first.'
                : 'Teams your ministry sets up will appear here.'
          }
          action={
            options.ministries.length === 0 &&
            hasPermission(ctx, 'ministries.manage') && (
              <Button asChild variant="secondary">
                <Link href="/app/ministries">Open ministries</Link>
              </Button>
            )
          }
        />
      ) : (
        teams.map((team) => (
          <SectionCard
            key={team.id}
            title={team.name}
            description={`${team.ministryName} · ${team.members.length === 1 ? '1 member' : `${team.members.length} members`}`}
            actions={team.canManage && <AddMemberButton teamId={team.id} teamName={team.name} />}
          >
            {team.members.length === 0 ? (
              <p className="text-sm text-muted">No members yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {team.members.map((member) => (
                  <li key={member.membershipId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="space-y-1.5">
                      <p className="font-medium">{member.name}</p>
                      <p className="flex flex-wrap gap-1.5">
                        {member.roleIds.length === 0 ? (
                          <span className="text-sm text-muted">No roles yet</span>
                        ) : (
                          member.roleIds.map((roleId) => (
                            <Badge key={roleId} tone={roleId === member.primaryRoleId ? 'green' : 'neutral'}>
                              {roleName.get(roleId) ?? 'Role'}
                              {roleId === member.primaryRoleId && <span className="sr-only"> (main role)</span>}
                            </Badge>
                          ))
                        )}
                      </p>
                      {member.away.length > 0 && (
                        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                          Away:
                          {member.away.map((away) => (
                            <AwayChip key={away.id} unavailabilityId={away.id} label={away.label} canManage={team.canManage} />
                          ))}
                        </p>
                      )}
                    </div>
                    {team.canManage && <MemberMenu member={member} teamName={team.name} roles={activeRoles} today={today} />}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ))
      )}
    </div>
  );
}
