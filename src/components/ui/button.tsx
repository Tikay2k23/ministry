import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-brand-deep text-white hover:bg-brand-deep-hover disabled:bg-brand-deep/50',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-ground disabled:text-muted',
  ghost: 'bg-transparent text-ink hover:bg-ink/5 disabled:text-muted',
  danger: 'bg-error text-white hover:bg-error/90 disabled:bg-error/50',
} as const;

const sizes = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-[15px]',
  lg: 'h-12 px-5 text-base', // public forms: 48px touch target
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Render the child element (e.g. a Link) with button styling. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', asChild = false, type, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
