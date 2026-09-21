'use client';

import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

/**
 * The filter panel above the Daily Journal table. It is an ordinary GET form — the page reads
 * everything from the URL — shown inline on a desktop and in a sheet on a phone, where seven
 * fields above the table would push the names off the screen.
 *
 * Choosing a Primary Leader also decides which Direct Leaders exist, so that select submits the
 * form as soon as it changes and comes back filled in.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface JournalFiltersProps {
  date: string;
  today: string;
  primaryLeaderId: string;
  leaderId: string;
  ministryId: string;
  role: string;
  status: string;
  q: string;
  sort: string;
  view: string;
  branches: FilterOption[];
  branchLeaders: FilterOption[];
  ministries: FilterOption[];
  roles: FilterOption[];
  statuses: FilterOption[];
  contactHint: boolean;
  /** How many of the filters are set, for the badge on the phone button. */
  activeCount: number;
}

function Fields({ id, props }: { id: string; props: JournalFiltersProps }) {
  const {
    date,
    today,
    primaryLeaderId,
    leaderId,
    ministryId,
    role,
    status,
    q,
    sort,
    branches,
    branchLeaders,
    ministries,
    roles,
    statuses,
    contactHint,
    view,
  } = props;
  const label = 'text-xs font-semibold uppercase tracking-wider text-muted';
  // Narrowing to a different group starts the list again rather than landing on an empty page 4.
  const submitOnChange = (event: { currentTarget: HTMLElement }) => {
    const form = event.currentTarget.closest('form') as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <>
      {sort !== 'status' && <input type="hidden" name="sort" value={sort} />}
      {view && <input type="hidden" name="view" value={view} />}
      <div className="space-y-1">
        <label htmlFor={`${id}-date`} className={label}>
          Day
        </label>
        <input
          id={`${id}-date`}
          name="date"
          type="date"
          max={today}
          defaultValue={date}
          className={inputClassName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-primaryLeaderId`} className={label}>
          Primary Leader
        </label>
        <select
          id={`${id}-primaryLeaderId`}
          name="primaryLeaderId"
          defaultValue={primaryLeaderId}
          onChange={submitOnChange}
          className={inputClassName}
          disabled={branches.length === 0}
        >
          <option value="">All ministry</option>
          {branches.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-leaderId`} className={label}>
          Direct Leader
        </label>
        <select
          id={`${id}-leaderId`}
          name="leaderId"
          defaultValue={leaderId}
          className={inputClassName}
          disabled={branchLeaders.length === 0}
        >
          <option value="">
            {primaryLeaderId ? 'Everyone in the group' : 'All leaders'}
          </option>
          {branchLeaders.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-role`} className={label}>
          Role
        </label>
        <select id={`${id}-role`} name="role" defaultValue={role} className={inputClassName}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {ministries.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={`${id}-ministryId`} className={label}>
            Ministry
          </label>
          <select
            id={`${id}-ministryId`}
            name="ministryId"
            defaultValue={ministryId}
            className={inputClassName}
          >
            <option value="">Any ministry</option>
            {ministries.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor={`${id}-status`} className={label}>
          Status
        </label>
        <select id={`${id}-status`} name="status" defaultValue={status} className={inputClassName}>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1 sm:col-span-2 lg:col-span-1">
        <label htmlFor={`${id}-q`} className={label}>
          Search
        </label>
        <input
          id={`${id}-q`}
          name="q"
          defaultValue={q}
          placeholder={contactHint ? 'Name or mobile' : 'Name'}
          className={inputClassName}
        />
      </div>
    </>
  );
}

export function JournalFilters(props: JournalFiltersProps) {
  const [open, setOpen] = useState(false);
  const { activeCount } = props;

  return (
    <>
      {/* Phones: one button, and the same form inside a sheet. */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" className="w-full">
              <SlidersHorizontal aria-hidden className="size-4" /> Filters
              {activeCount > 0 && (
                <span className="tabular rounded-full bg-ink/10 px-2 text-xs">{activeCount}</span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <form method="get" className="grid gap-3 px-5 pb-6">
              <Fields id="sheet" props={props} />
              <div className="flex gap-2 pt-1">
                <Button type="submit" className="flex-1">
                  Show
                </Button>
                {activeCount > 0 && (
                  <Button asChild variant="ghost">
                    <Link href="/app/journal">Reset</Link>
                  </Button>
                )}
              </div>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* Tablets and up: the panel itself. */}
      <form
        method="get"
        className="hidden gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 md:grid md:grid-cols-3 lg:grid-cols-4"
      >
        <Fields id="panel" props={props} />
        <div className="flex items-end gap-2">
          <Button type="submit">Show</Button>
          {activeCount > 0 && (
            <Button asChild variant="ghost">
              <Link href="/app/journal">Reset</Link>
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
