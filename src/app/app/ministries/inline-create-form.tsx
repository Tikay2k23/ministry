'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Result } from '@/server/errors';

/**
 * Small collapsible create form used on ministry pages. Children render the fields;
 * the action receives the FormData. The form resets only after success.
 */
export function InlineCreateForm({
  openLabel,
  submitLabel,
  action,
  children,
}: {
  openLabel: string;
  submitLabel: string;
  action: (formData: FormData) => Promise<Result<unknown>>;
  children: ReactNode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        formRef.current?.reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error.fieldErrors ? Object.values(result.error.fieldErrors).flat().join(' ') : result.error.message);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {openLabel}
      </Button>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-ground/60 p-4">
      {error && <Alert tone="error">{error}</Alert>}
      {children}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
