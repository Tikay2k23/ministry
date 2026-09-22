'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { NavItem } from './nav-items';
import { SidebarNav } from './sidebar-nav';

/**
 * The portal's navigation on a phone or tablet: one bar at the top of the page, and the same
 * sidebar in a panel behind it. Below `lg` the sidebar itself is hidden — stacked above the
 * content it pushed the page a whole screen down, so a leader had to scroll past fourteen links
 * to read who has not journaled yet.
 *
 * `footer` is rendered by the server (it holds the sign-out form), so it is passed in rather than
 * built here.
 */
export function MobileNav({
  items,
  name,
  email,
  footer,
}: {
  items: NavItem[];
  name: string;
  email: string;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Following a link should leave the menu behind, and so should the back button. Adjusting the
  // state while rendering is React's own answer to this; an effect would close it a frame later.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  const unread = items.reduce((n, item) => n + (item.count ?? 0), 0);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-surface px-4 py-2 print:hidden lg:hidden">
      <Link href="/app" aria-label="GenTouch dashboard" className="shrink-0">
        <BrandMark size={36} />
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" className="ml-auto">
            <Menu aria-hidden className="size-5" />
            Menu
            {unread > 0 && (
              <span className="tabular rounded-full bg-brand-deep px-2 py-0.5 text-xs font-semibold text-white">
                {unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] max-w-[85vw]">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3">
            <SidebarNav items={items} />
          </div>
          <div className="border-t border-line px-5 py-4">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
            <div className="mt-3">{footer}</div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
