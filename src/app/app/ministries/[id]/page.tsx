import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Field, inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getMinistry } from '@/server/modules/ministries/ministries.service';
import { hasStructureScope } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { createDepartmentAction, createTeamAction } from '../actions';
import { InlineCreateForm } from '../inline-create-form';
import { EndMembershipButton } from './end-membership-button';

export const metadata: Metadata = { title: 'Ministry' };

const POSITION_LABEL: Record<string, string> = { member: 'Member', worker: 'Worker', assistant_head: 'Assistant head', head: 'Head' };
const TEAM_TYPES = ['general', 'worship', 'prayer', 'production', 'hospitality'];

export default async function MinistryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();

  let detail;
  try {
    detail = await getMinistry(getDb(), ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { ministry, departments, teams, members } = detail;
  const canStructure = hasStructureScope(ctx, 'ministry.structure.manage', { ministryId: ministry.id });
  const canMembers = hasStructureScope(ctx, 'ministry.members.manage', { ministryId: ministry.id });

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/ministries', label: 'Ministries' }}
        title={ministry.name}
        description={ministry.description ?? `Code ${ministry.code}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-base">Departments</h2>
          {departments.length === 0 ? (
            <p className="text-sm text-muted">No departments.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <li key={d.id}>
                  <Badge tone="slate">{d.name}</Badge>
                </li>
              ))}
            </ul>
          )}
          {canStructure && (
            <InlineCreateForm openLabel="Add department" submitLabel="Add" action={createDepartmentAction}>
              <input type="hidden" name="ministryId" value={ministry.id} />
              <Field label="Department name" name="name" required placeholder="Music" />
            </InlineCreateForm>
          )}
        </section>

        <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-base">Teams</h2>
          {teams.length === 0 ? (
            <p className="text-sm text-muted">No teams.</p>
          ) : (
            <ul className="divide-y divide-line">
              {teams.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">
                    {t.name}{' '}
                    <span className="font-normal text-muted">
                      · {t.teamType}
                      {t.departmentId ? ` · ${departments.find((d) => d.id === t.departmentId)?.name ?? ''}` : ''}
                    </span>
                  </span>
                  <span className="tabular text-muted">{t.memberCount} members</span>
                </li>
              ))}
            </ul>
          )}
          {canStructure && (
            <InlineCreateForm openLabel="Add team" submitLabel="Add" action={createTeamAction}>
              <input type="hidden" name="ministryId" value={ministry.id} />
              <Field label="Team name" name="name" required placeholder="Team A" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="teamType" className="block text-sm font-medium">
                    Type
                  </label>
                  <select id="teamType" name="teamType" className={inputClassName} defaultValue="general">
                    {TEAM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t[0]!.toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="departmentId" className="block text-sm font-medium">
                    Department
                  </label>
                  <select id="departmentId" name="departmentId" className={inputClassName} defaultValue="">
                    <option value="">None</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </InlineCreateForm>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">Serving ({members.length})</h2>
          {canMembers && <p className="text-sm text-muted">Add people to this ministry from their profile.</p>}
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-muted">No one is serving here yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Position</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Since</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m) => (
                  <tr key={m.membershipId}>
                    <td className="px-4 py-3">
                      <Link href={`/app/people/${m.personId}`} className="font-medium hover:underline">
                        {m.firstName} {m.lastName}
                      </Link>
                      {m.isPrimary && <span className="ml-2 text-xs text-muted">primary</span>}
                    </td>
                    <td className="px-4 py-3">{POSITION_LABEL[m.position] ?? m.position}</td>
                    <td className="px-4 py-3 text-muted">{m.departmentName ?? '—'}</td>
                    <td className="tabular px-4 py-3 text-muted">{m.startedOn}</td>
                    <td className="px-4 py-3 text-right">
                      {canMembers && <EndMembershipButton membershipId={m.membershipId} ministryId={ministry.id} name={`${m.firstName} ${m.lastName}`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
