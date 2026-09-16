'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useTransition } from 'react';
import { get, useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import type { z } from 'zod';
import type { Result } from '@/server/errors';

/**
 * React Hook Form wired to a server action (docs/02a §1). The same Zod schema validates in the
 * browser, for instant feedback, and again in the service, which stays the authority: field
 * errors the server returns appear on their fields, anything else as one message for the form.
 *
 * The schema must be importable in the browser, so keep it in a `*.schemas.ts` file without
 * server imports (like src/server/modules/people/people.schemas.ts).
 */
export function useActionForm<Input extends FieldValues, Output extends FieldValues, Data>({
  schema,
  defaultValues,
  action,
  onSuccess,
}: {
  schema: z.ZodType<Output, Input>;
  defaultValues: DefaultValues<Input>;
  action: (values: Output) => Promise<Result<Data>>;
  onSuccess?: (data: Data) => void;
}) {
  const form = useForm<Input, unknown, Output>({ resolver: zodResolver(schema), defaultValues, mode: 'onTouched' });
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = form.handleSubmit(
    (values) =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          setFormError(null);
          try {
            const result = await action(values);
            if (result.ok) {
              onSuccess?.(result.data);
              return;
            }
            for (const [name, messages] of Object.entries(result.error.fieldErrors ?? {})) {
              form.setError(name as Path<Input>, { type: 'server', message: messages.join(' ') });
            }
            // Also as one message, in case an error belongs to a field this form doesn't show.
            setFormError(result.error.message);
          } finally {
            resolve();
          }
        });
      }),
  );

  /** A field's error messages, in the shape the `Field` component takes. */
  const errorsFor = (name: Path<Input>): string[] | undefined => {
    const message: unknown = get(form.formState.errors, name)?.message;
    return typeof message === 'string' && message ? [message] : undefined;
  };

  return { form, submit, pending: pending || form.formState.isSubmitting, formError, errorsFor };
}
