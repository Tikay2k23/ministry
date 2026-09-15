'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, inputClassName } from '@/components/ui/field';
import { inviteUserAction } from './actions';

export function InviteForm({ roles }: { roles: { key: string; name: string; description: string }[] }) {
  const [state, action, pending] = useActionState(inviteUserAction, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  return (
    <form action={action} className="space-y-4">
      {state?.ok && (
        <Alert tone="success" title="Invitation sent">
          {state.data.email} will receive an email with instructions to sign in.
        </Alert>
      )}
      {state && !state.ok && !state.error.fieldErrors && <Alert tone="error">{state.error.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="firstName" autoComplete="off" required errors={errors?.firstName} />
        <Field label="Last name" name="lastName" autoComplete="off" required errors={errors?.lastName} />
      </div>
      <Field label="Email address" name="email" type="email" autoComplete="off" required errors={errors?.email} />
      <div className="space-y-1.5">
        <label htmlFor="roleKey" className="block text-sm font-medium">
          Role
        </label>
        <select id="roleKey" name="roleKey" required className={inputClassName} defaultValue="">
          <option value="" disabled>
            Choose a role…
          </option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name} — {r.description}
            </option>
          ))}
        </select>
        {errors?.roleKey && (
          <p className="text-sm text-error" role="alert">
            {errors.roleKey.join(' ')}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending invitation…' : 'Send invitation'}
      </Button>
    </form>
  );
}
