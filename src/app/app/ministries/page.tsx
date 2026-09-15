import { Church } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { listMinistries } from '@/server/modules/ministries/ministries.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { createMinistryAction } from './actions';
import { InlineCreateForm } from './inline-create-form';

export const metadata: Metadata = { title: 'Ministries' };

export default async function MinistriesPage() {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'ministries.view')) notFound();
  const ministries = await listMinistries(getDb(), ctx);
  const canCreate = hasGlobal(ctx, 'ministries.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ministries"
        description="Where people serve. Separate from the leadership structure: someone’s leader and their ministry can differ."
      />

      {canCreate && (
        <InlineCreateForm openLabel="Add a ministry" submitLabel="Create ministry" action={createMinistryAction}>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Name" name="name" required placeholder="Worship" />
            <Field label="Short code" name="code" required placeholder="WOR" hint="Used in imports" />
          </div>
          <Field label="Description (optional)" name="description" />
        </InlineCreateForm>
      )}

      {ministries.length === 0 ? (
        <EmptyState icon={Church} title="No ministries yet" description={canCreate ? 'Add your first ministry above.' : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Ministry</th>
                <th className="px-4 py-3 font-semibold">Head</th>
                <th className="px-4 py-3 text-right font-semibold">Serving</th>
                <th className="px-4 py-3 text-right font-semibold">Departments</th>
                <th className="px-4 py-3 text-right font-semibold">Teams</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ministries.map((m) => (
                <tr key={m.id} className="hover:bg-ground/60">
                  <td className="px-4 py-3">
                    <Link href={`/app/ministries/${m.id}`} className="font-medium hover:text-brand-deep hover:underline">
                      {m.name}
                    </Link>
                    <p className="text-xs text-muted">{m.code}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{m.heads ?? '—'}</td>
                  <td className="tabular px-4 py-3 text-right">{m.memberCount}</td>
                  <td className="tabular px-4 py-3 text-right">{m.departmentCount}</td>
                  <td className="tabular px-4 py-3 text-right">{m.teamCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
