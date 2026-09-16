import { Bell } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { listInbox } from '@/server/modules/notifications/notifications.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { MarkAllReadButton, MarkReadButton, OpenNotificationLink } from './inbox-actions';

export const metadata: Metadata = { title: 'Notifications' };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function inboxHref(show: 'unread' | null, page = 1) {
  const params = new URLSearchParams();
  if (show) params.set('show', show);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/app/notifications?${query}` : '/app/notifications';
}

/** The personal inbox, unread first (docs/04 A24). */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { ctx } = await requirePortal();
  const db = getDb();
  const show = first(sp.show) === 'unread' ? 'unread' : null;
  const [inbox, profile] = await Promise.all([
    listInbox(db, ctx, { unreadOnly: show === 'unread', page: first(sp.page) }),
    getSetting(db, 'ministry.profile'),
  ]);
  const pages = Math.max(1, Math.ceil(inbox.total / inbox.pageSize));
  const tabs = [
    { key: 'all', label: 'All', href: inboxHref(null), current: show === null },
    { key: 'unread', label: inbox.unread > 0 ? `Unread (${inbox.unread})` : 'Unread', href: inboxHref('unread'), current: show === 'unread' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Updates about the people and prayer chains you look after."
        actions={inbox.unread > 0 && <MarkAllReadButton />}
      />

      <nav aria-label="Show notifications" className="flex gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.current ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium',
              tab.current ? 'bg-brand-deep text-white' : 'bg-surface text-ink ring-1 ring-line hover:bg-ground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {inbox.items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={show === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
          description={show === 'unread' ? 'Nothing new is waiting for you.' : 'Prayer slots that need follow-up and other updates will appear here.'}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {inbox.items.map((item) => {
            const unread = item.readAt === null;
            return (
              <li
                key={item.id}
                className={cn('flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between', unread && 'bg-brand-leaf-tint/40')}
              >
                <div className="space-y-1">
                  <p className={cn('flex items-center gap-2', unread ? 'font-semibold' : 'font-medium')}>
                    {unread && <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand-deep" />}
                    {item.title}
                    {unread && <span className="sr-only"> (unread)</span>}
                  </p>
                  <p className="text-muted">{item.body}</p>
                  <p className="text-xs text-muted">{formatDateTime(item.createdAt, profile.timezone)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {item.portalPath?.startsWith('/app/') && (
                    <OpenNotificationLink id={item.id} href={item.portalPath} label={item.actionLabel ?? 'Open'} unread={unread} />
                  )}
                  {unread && <MarkReadButton id={item.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {inbox.page > 1 ? (
            <Link href={inboxHref(show, inbox.page - 1)} className="font-medium text-brand-deep hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {inbox.page} of {pages}
          </span>
          {inbox.page < pages ? (
            <Link href={inboxHref(show, inbox.page + 1)} className="font-medium text-brand-deep hover:underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
