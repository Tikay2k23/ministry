import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const tones = {
  info: { className: 'bg-info-tint text-info border-info/20', Icon: Info },
  success: { className: 'bg-brand-leaf-tint text-brand-deep border-brand-deep/20', Icon: CircleCheck },
  warning: { className: 'bg-warn-tint text-warn border-warn/20', Icon: TriangleAlert },
  error: { className: 'bg-error-tint text-error border-error/20', Icon: CircleAlert },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', toneClass, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink/80">{children}</div>}
      </div>
    </div>
  );
}
