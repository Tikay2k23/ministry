import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { formatClockTime } from '@/lib/time-range';
import { formatMinutes, SERVING_CATEGORY_LABELS } from '@/server/modules/devotional/devotional.schemas';
import { gatheringTypeCreationOptions, listGatheringTypes } from '@/server/modules/devotional/gathering-types.service';
import { listServingRoles } from '@/server/modules/devotional/serving-roles.service';
import { canViewWorshipTeams } from '@/server/modules/devotional/teams.service';
import { hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DevotionalTabs } from '../devotional-tabs';
import { NewGatheringTypeButton, ServingRoleButton } from './setup-actions';

export const metadata: Metadata = { title: 'Devotional setup' };

/** Devotional setup (docs/04 A21): kinds of gatherings and the serving-role vocabulary. */
export default async function DevotionalSetupPage() {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'devotional.view')) notFound();
  const db = getDb();
  const [types, roles, creation] = await Promise.all([listGatheringTypes(db, ctx), listServingRoles(db, ctx), gatheringTypeCreationOptions(db, ctx)]);
  const canManageRoles = hasPermission(ctx, 'devotional.teams.manage');
  if (!canManageRoles && !creation.canCreate && !types.some((type) => type.canManage)) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title="Devotional" description="Kinds of gatherings, with their schedules and roster templates, and the roles people serve in." />
      <DevotionalTabs teams={canViewWorshipTeams(ctx)} setup />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Gatherings"
          description="Each has its own roster template, schedules and coordinators."
          actions={creation.canCreate && <NewGatheringTypeButton ministries={creation.ministries} requiresMinistry={creation.requiresMinistry} />}
        >
          {types.length === 0 ? (
            <p className="text-sm text-muted">No gatherings yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {types.map((type) => (
                <li key={type.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <Link href={`/app/devotional/setup/${type.id}`} className="font-medium text-ink hover:text-brand-deep hover:underline">
                      {type.name}
                    </Link>
                    <p className="text-sm text-muted">
                      {formatClockTime(type.defaultStartTime)} for {formatMinutes(type.defaultDurationMinutes)}
                      {type.ministryName ? ` · ${type.ministryName}` : ''}
                    </p>
                  </div>
                  {!type.isActive && <Badge tone="slate">Not in use</Badge>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Serving roles"
          description="Shared by every gathering. Switched-off roles stay on past rosters."
          actions={canManageRoles && <ServingRoleButton />}
        >
          <ul className="divide-y divide-line">
            {roles.map((role) => (
              <li key={role.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div>
                  <p className={role.isActive ? 'font-medium' : 'text-muted'}>
                    {role.name}
                    {!role.isActive && <span className="text-sm"> (not in use)</span>}
                  </p>
                  <p className="text-xs text-muted">{SERVING_CATEGORY_LABELS[role.category]}</p>
                </div>
                {canManageRoles && <ServingRoleButton role={role} />}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
