import { FileUp, SearchX, UserPlus, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClassName } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { buildHref, Pagination } from '@/components/ui/pagination';
import { isAppError } from '@/server/errors';
import { listMinistries } from '@/server/modules/ministries/ministries.service';
import { searchPeople } from '@/server/modules/people/people.queries';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'People' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'people.view')) notFound();
  const db = getDb();
  const sp = await searchParams;

  const params = {
    q: first(sp.q),
    status: first(sp.status),
    placement: first(sp.placement),
    ministryId: first(sp.ministryId),
    leaderId: first(sp.leaderId),
    sort: first(sp.sort),
    page: first(sp.page),
  };
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;

  let result;
  try {
    result = await searchPeople(db, ctx, clean);
  } catch (error) {
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error;
    result = await searchPeople(db, ctx, { q: clean.q }); // ignore malformed filters from a hand-edited URL
  }

  const showContact = hasPermission(ctx, 'people.contact.view');
  const ministryOptions = hasPermission(ctx, 'ministries.view') ? await listMinistries(db, ctx) : [];
  const filtered = Boolean(clean.q || clean.status || clean.placement || clean.ministryId || clean.leaderId);
  const leaderFilterName = clean.leaderId ? result.items.find((p) => p.leader?.id === clean.leaderId)?.leader?.name : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        description="Everyone in your care, in one directory."
        actions={
          <>
            {hasPermission(ctx, 'people.registrations.confirm') && (
              <Button asChild variant="ghost">
                <Link href="/app/people/registrations">New registrations</Link>
              </Button>
            )}
            {hasGlobal(ctx, 'people.merge') && (
              <Button asChild variant="ghost">
                <Link href="/app/people/review">Review duplicates</Link>
              </Button>
            )}
            {hasPermission(ctx, 'people.export') && result.total > 0 && (
              <Button asChild variant="ghost">
                <a href={buildHref('/api/reports/people.csv', { ...clean, page: undefined })}>Download CSV</a>
              </Button>
            )}
            {hasGlobal(ctx, 'import.manage') && (
              <Button asChild variant="secondary">
                <Link href="/app/people/import">
                  <FileUp aria-hidden className="size-4" /> Import
                </Link>
              </Button>
            )}
            {hasPermission(ctx, 'people.create') && (
              <Button asChild>
                <Link href="/app/people/new">
                  <UserPlus aria-hidden className="size-4" /> Add person
                </Link>
              </Button>
            )}
          </>
        }
      />

      <form method="get" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="q" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Search
          </label>
          <input id="q" name="q" defaultValue={clean.q} placeholder="Name, mobile or person code" className={inputClassName} />
        </div>
        <div className="space-y-1">
          <label htmlFor="status" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Status
          </label>
          <select id="status" name="status" defaultValue={clean.status ?? ''} className={inputClassName}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="placement" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Leadership
          </label>
          <select id="placement" name="placement" defaultValue={clean.placement ?? ''} className={inputClassName}>
            <option value="">Anyone</option>
            <option value="placed">In the structure</option>
            <option value="unplaced">Not placed yet</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="ministryId" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Ministry
          </label>
          <select id="ministryId" name="ministryId" defaultValue={clean.ministryId ?? ''} className={inputClassName} disabled={ministryOptions.length === 0}>
            <option value="">Any</option>
            {ministryOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        {clean.leaderId && <input type="hidden" name="leaderId" value={clean.leaderId} />}
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href="/app/people">Clear</Link>
            </Button>
          )}
        </div>
      </form>

      {clean.leaderId && (
        <p className="text-sm">
          Showing the group of <strong>{leaderFilterName ?? 'the selected leader'}</strong> ·{' '}
          <Link href={buildHref('/app/people', { ...clean, leaderId: undefined, page: undefined })} className="text-brand-deep underline">
            show everyone
          </Link>
        </p>
      )}

      {result.total === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No one matches these filters" action={<Button asChild variant="secondary"><Link href="/app/people">Clear filters</Link></Button>} />
        ) : (
          <EmptyState
            icon={UsersRound}
            title="No people yet"
            description="Import your existing spreadsheet or add people one at a time."
            action={
              hasGlobal(ctx, 'import.manage') ? (
                <Button asChild>
                  <Link href="/app/people/import">Import people</Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Leader</th>
                  <th className="px-4 py-3 font-semibold">Level</th>
                  <th className="px-4 py-3 font-semibold">Ministry</th>
                  {showContact && <th className="px-4 py-3 font-semibold">Mobile</th>}
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.items.map((person) => (
                  <tr key={person.id} className="hover:bg-ground/60">
                    <td className="px-4 py-3">
                      <Link href={`/app/people/${person.id}`} className="font-medium text-ink hover:text-brand-deep hover:underline">
                        {person.name}
                      </Link>
                      <p className="tabular text-xs text-muted">{person.personCode}</p>
                    </td>
                    <td className="px-4 py-3">{person.leader?.name ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-muted">{person.levelName ?? (person.depth === null ? 'Not placed' : '—')}</td>
                    <td className="px-4 py-3 text-muted">{person.ministryName ?? '—'}</td>
                    {showContact && <td className="tabular px-4 py-3 text-muted">{person.phone ?? '—'}</td>}
                    <td className="px-4 py-3 text-right">
                      {person.status === 'inactive' && <Badge>Inactive</Badge>}
                      {person.registrationStatus === 'unconfirmed' && <Badge tone="amber">Unconfirmed</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/app/people" params={clean} />
        </>
      )}
    </div>
  );
}
