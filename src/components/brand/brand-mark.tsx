import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * The GenTouch logo (docs/04 §2 Brand). `public/brand/gentouch-logo.png` is the original artwork:
 * 1254 px square, transparent background, with the wordmark and the tagline drawn into the mark.
 *
 * The drawn tagline is too small to read below poster size, so `withTagline` repeats it as text —
 * that is also what a screen reader announces, since the image itself is named only "GenTouch".
 * `size` is the rendered height in pixels; the artwork is square.
 */
export function BrandMark({ className, size = 44, withTagline = false }: { className?: string; size?: number; withTagline?: boolean }) {
  // Ask for more pixels than the box needs, so the logo stays sharp on printed cards and posters.
  const pixels = Math.min(1254, size * 4);
  return (
    <div className={cn('select-none', className)}>
      <Image
        src="/brand/gentouch-logo.png"
        alt="GenTouch"
        width={pixels}
        height={pixels}
        priority
        className="mx-auto"
        style={{ width: size, height: size }}
      />
      {withTagline && (
        <p className="mt-1 leading-tight text-muted" style={{ fontSize: Math.round(Math.max(11, size * 0.13)) }}>
          There&apos;s a Nation Inside of You!
        </p>
      )}
    </div>
  );
}
