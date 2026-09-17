'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/** Switches between Settings and System health (docs/04 §3: Settings · Health). */
export function AdminTabs({ health }: { health: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: '/app/admin/settings', label: 'Settings' },
    ...(health ? [{ href: '/app/admin/health', label: 'System health' }] : []),
  ];
  return (
    <nav aria-label="Settings" className="flex gap-6 border-b border-line">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-1 pb-2 text-sm font-semibold', active ? 'border-brand-deep text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
