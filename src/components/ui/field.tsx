import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const inputClassName =
  'block w-full rounded-lg border border-line-strong bg-surface px-3 h-10 text-[15px] text-ink ' +
  'placeholder:text-muted/70 focus:border-brand-deep focus:outline-none focus:ring-2 focus:ring-brand-deep/20 ' +
  'aria-[invalid=true]:border-error aria-[invalid=true]:ring-error/20 disabled:bg-ground';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  errors?: string[];
}

/** Labelled input with hint and accessible error messages. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, errors, id, className, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={cn(hint && hintId, hasError && errorId) || undefined}
        className={cn(inputClassName, className)}
        {...props}
      />
      {hint && !hasError && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-sm text-error" role="alert">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
});
