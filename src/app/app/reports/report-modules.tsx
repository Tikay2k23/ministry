import Link from 'next/link';
import { cn } from '@/lib/cn';

/** Switches between the report areas the user can open (docs/04 A23). Hidden when there is only one. */
export function ReportModules({ active, journal, prayer }: { active: 'journal' | 'prayer'; journal: boolean; prayer: boolean }) {
  const modules = [
    ...(journal ? [{ key: 'journal', href: '/app/reports', label: 'Daily Journal' }] : []),
    ...(prayer ? [{ key: 'prayer', href: '/app/reports/prayer', label: 'Prayer Chain' }] : []),
  ];
  if (modules.length < 2) return null;

  return (
    <nav aria-label="Report area" className="flex gap-6 border-b border-line">
      {modules.map((module) => (
        <Link
          key={module.key}
          href={module.href}
          aria-current={module.key === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-1 pb-2 text-sm font-semibold',
            module.key === active ? 'border-brand-deep text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {module.label}
        </Link>
      ))}
    </nav>
  );
}
