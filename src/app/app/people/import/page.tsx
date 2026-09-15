import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/dates';
import { listImportJobs } from '@/server/modules/import/people-import.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { UploadForm } from './upload-form';

export const metadata: Metadata = { title: 'Import people' };

const COLUMNS: { name: string; required?: boolean; notes: string }[] = [
  { name: 'first_name', required: true, notes: 'First name' },
  { name: 'last_name', required: true, notes: 'Last name' },
  { name: 'ref', notes: 'Any short label (e.g. MARK) so others in the file can name this person as their leader' },
  { name: 'leader', notes: 'Their leader: a ref from this file, a person code, a mobile number, an email, or an exact full name' },
  { name: 'mobile', notes: 'e.g. 0917 123 4567 — invalid numbers are left blank' },
  { name: 'email', notes: 'Optional' },
  { name: 'birthday', notes: 'MM/DD/YYYY, or MM/DD without a year' },
  { name: 'gender', notes: 'male / female (optional)' },
  { name: 'joined_on', notes: 'MM/DD/YYYY' },
  { name: 'ministry', notes: 'Name or code of an existing ministry' },
  { name: 'designations', notes: 'member; worker; pastor; staff' },
  { name: 'accepts_members', notes: 'yes for leaders who receive new people' },
];

const STATUS_TONE = { previewed: 'amber', completed: 'green', failed: 'red', cancelled: 'neutral' } as const;

export default async function ImportPage() {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'import.manage')) notFound();
  const db = getDb();
  const [jobs, profile] = await Promise.all([listImportJobs(db, ctx), getSetting(db, 'ministry.profile')]);

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: '/app/people', label: 'People' }}
        title="Import people"
        description="Bring in your existing spreadsheet, including who leads whom. You’ll see a preview before anything is saved."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 className="text-lg">1. Prepare your file</h2>
          <p className="text-sm text-muted">
            Save your spreadsheet as CSV. Column names don’t have to match exactly — “First Name” or “Mobile Number” work
            too.
          </p>
          <a
            href="/api/import/people/template"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-deep hover:underline"
          >
            <Download aria-hidden className="size-4" /> Download the template
          </a>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-line">
                {COLUMNS.map((c) => (
                  <tr key={c.name}>
                    <td className="whitespace-nowrap py-1.5 pr-3 align-top">
                      <code className="text-xs">{c.name}</code>
                      {c.required && <span className="ml-1 text-xs text-error">required</span>}
                    </td>
                    <td className="py-1.5 text-muted">{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h2 className="text-lg">2. Upload and preview</h2>
          <UploadForm />
          {jobs.length > 0 && (
            <div className="border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold">Recent imports</h3>
              <ul className="divide-y divide-line text-sm">
                {jobs.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/app/people/import/${job.id}`} className="font-medium hover:underline">
                      {job.fileName}
                    </Link>
                    <span className="flex items-center gap-2 text-muted">
                      <span className="tabular">{formatDateTime(job.createdAt, profile.timezone)}</span>
                      <Badge tone={STATUS_TONE[job.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{job.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
