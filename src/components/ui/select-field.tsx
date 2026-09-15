import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { inputClassName } from './field';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: ReactNode;
  errors?: string[];
}

export function SelectField({ label, options, placeholder, hint, errors, id, className, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hasError = Boolean(errors?.length);
  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cn(inputClassName, className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !hasError && (
        <p id={`${selectId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={`${selectId}-error`} className="text-sm text-error" role="alert">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}
