'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/** Switches between the devotional pages (docs/04 A19–A21). */
export function DevotionalTabs({ setup }: { setup: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: '/app/devotional', label: 'Calendar', active: pathname === '/app/devotional' },
    { href: '/app/devotional/teams', label: 'Worship teams', active: pathname.startsWith('/app/devotional/teams') },
    ...(setup ? [{ href: '/app/devotional/setup', label: 'Setup', active: pathname.startsWith('/app/devotional/setup') }] : []),
  ];
  return (
    <nav aria-label="Devotional" className="flex gap-6 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-1 pb-2 text-sm font-semibold',
            tab.active ? 'border-brand-deep text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
