import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand/brand-mark';
import { MobileNav } from '@/components/portal/mobile-nav';
import { NAV_ITEMS } from '@/components/portal/nav-items';
import { SidebarNav } from '@/components/portal/sidebar-nav';
import { SkipLink } from '@/components/portal/skip-link';
import { Button } from '@/components/ui/button';
import { countUnreadNotifications } from '@/server/modules/notifications/notifications.service';
import { hasChainScope, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { signOutAction } from './actions';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user } = await requirePortal();
  const unread = await countUnreadNotifications(getDb(), ctx);
  const items = NAV_ITEMS.filter(
    (item) =>
      !item.permission ||
      (item.chainScope ? hasChainScope(ctx, item.permission) : hasPermission(ctx, item.permission)),
  ).map((item) => (item.icon === 'notifications' ? { ...item, count: unread } : item));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <SkipLink />
      {/* Below lg the same navigation lives in a panel behind one button (components/portal/mobile-nav). */}
      <aside className="hidden border-line bg-surface print:hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Link href="/app" aria-label="GenTouch dashboard">
            <BrandMark size={52} />
          </Link>
        </div>
        <div className="px-3 pb-3 lg:flex-1 lg:overflow-y-auto">
          <SidebarNav items={items} />
        </div>
        <div className="border-t border-line px-5 py-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <form action={signOutAction} className="mt-3">
            <Button type="submit" variant="ghost" size="sm" className="-ml-3">
              <LogOut aria-hidden className="size-4" /> Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <MobileNav
          items={items}
          name={user.name}
          email={user.email}
          footer={
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm" className="-ml-3">
                <LogOut aria-hidden className="size-4" /> Sign out
              </Button>
            </form>
          }
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1200px] px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-10 print:max-w-none print:p-0"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
