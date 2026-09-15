import { cn } from '@/lib/cn';

/**
 * Text placeholder for the GenTouch logo until the original files are added to
 * public/brand/ (see docs/04 §2 Brand). Replace with <Image src="/brand/…" /> then.
 */
export function BrandMark({ className, withTagline = false }: { className?: string; withTagline?: boolean }) {
  return (
    <div className={cn('select-none', className)}>
      <p className="font-display text-xl font-extrabold leading-none tracking-tight text-brand-deep">
        Gen<span className="text-brand-touch">T</span>ouch
      </p>
      {withTagline && <p className="mt-1 text-xs text-muted">There&apos;s a Nation Inside of You!</p>}
    </div>
  );
}
