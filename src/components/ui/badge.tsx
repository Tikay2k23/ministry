import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const tones = {
  neutral: 'bg-ink/5 text-muted',
  green: 'bg-brand-leaf-tint text-brand-deep',
  amber: 'bg-warn-tint text-warn',
  slate: 'bg-info-tint text-info',
  red: 'bg-error-tint text-error',
} as const;

/** Small status label. Always text (never colour alone) for accessibility. */
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}
