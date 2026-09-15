import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-10 text-center">
      {Icon && <Icon aria-hidden className="mx-auto mb-3 size-8 text-status-notyet" />}
      <p className="font-display text-lg font-bold">{title}</p>
      {description && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</div>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
