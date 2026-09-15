import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/lib/dates';
import { grantableGlobalRoles, listUsers } from '@/server/modules/iam/users.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { DeactivateButton } from './deactivate-button';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Users & Permissions' };

const STATUS_LABEL: Record<string, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
};

export default async function UsersPage() {
  const { ctx, user: me } = await requirePortal();
  if (!hasGlobal(ctx, 'iam.users.view')) notFound();

  const db = getDb();
  const [users, profile] = await Promise.all([listUsers(db, ctx), getSetting(db, 'ministry.profile')]);
  const canManage = hasGlobal(ctx, 'iam.users.manage');
  const roleOptions = canManage ? grantableGlobalRoles(ctx) : [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl">Users &amp; Permissions</h1>
        <p className="text-muted">Portal accounts for pastors, leaders and ministry staff. Members never need an account.</p>
      </header>

      {canManage && (
        <section aria-labelledby="invite" className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 id="invite" className="text-lg">
            Invite someone
          </h2>
          <p className="mt-1 text-sm text-muted">
            Leader and Primary Leader roles are given from a person’s profile once your people and leadership structure
            are imported (next milestone).
          </p>
          <div className="mt-5">
            <InviteForm roles={roleOptions} />
          </div>
        </section>
      )}

      <section aria-labelledby="accounts">
        <h2 id="accounts" className="sr-only">
          Accounts
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Roles</th>
                <th className="px-4 py-3 font-semibold">Two-step</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Last sign-in</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-muted">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.length === 0 && <span className="text-muted">—</span>}
                      {u.roles.map((r) => (
                        <span key={r.assignmentId} className="rounded-full bg-brand-leaf-tint px-2.5 py-0.5 text-xs font-medium text-brand-deep">
                          {r.roleName}
                          {r.scopeType === 'branch' && (r.branchMaxDepth === 1 ? ' · own group' : ' · branch')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.twoFactorEnabled ? 'On' : <span className="text-muted">Off</span>}</td>
                  <td className="px-4 py-3">{STATUS_LABEL[u.status] ?? u.status}</td>
                  <td className="tabular px-4 py-3 text-muted">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt, profile.timezone) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && u.id !== me.id && u.status !== 'deactivated' && <DeactivateButton userId={u.id} name={u.name} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
