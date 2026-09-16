'use client';

import { Bell, Church, ClipboardList, HandHeart, HeartHandshake, LayoutDashboard, Music, Network, NotebookPen, ShieldCheck, UsersRound, UserRoundCog } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavItem } from './nav-items';

const ICONS = {
  dashboard: LayoutDashboard,
  journal: NotebookPen,
  prayer: HandHeart,
  devotional: Music,
  followups: HeartHandshake,
  reports: ClipboardList,
  people: UsersRound,
  leadership: Network,
  ministries: Church,
  users: UserRoundCog,
  notifications: Bell,
  account: ShieldCheck,
} as const;

const SECTIONS: { key: NavItem['section']; label: string | null }[] = [
  { key: 'main', label: null },
  { key: 'organisation', label: 'Organisation' },
  { key: 'admin', label: 'Administration' },
  { key: 'personal', label: 'You' },
];

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="space-y-6">
      {SECTIONS.filter((s) => items.some((i) => i.section === s.key)).map((section) => (
        <div key={section.key} className="space-y-1">
          {section.label && (
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">{section.label}</p>
          )}
          {items
            .filter((i) => i.section === section.key)
            .map((item) => {
              const Icon = ICONS[item.icon];
              const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors',
                    active ? 'bg-brand-leaf-tint font-semibold text-brand-deep' : 'text-ink hover:bg-ink/5',
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  {item.label}
                  {item.count ? (
                    <span className="tabular ml-auto rounded-full bg-brand-deep px-2 py-0.5 text-xs font-semibold text-white">
                      {item.count}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
