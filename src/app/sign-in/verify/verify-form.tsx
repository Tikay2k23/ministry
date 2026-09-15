'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { verifyCodeAction } from './actions';

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={action} className="space-y-4">
      {error?.code === 'RATE_LIMITED' && <Alert tone="error">{error.message}</Alert>}
      <Field
        label="Verification code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        maxLength={12}
        errors={error?.fieldErrors?.code}
        className="text-center text-lg tracking-[0.3em]"
      />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Checking…' : 'Verify'}
      </Button>
    </form>
  );
}
