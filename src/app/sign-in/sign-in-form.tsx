'use client';

import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

export function SignInForm() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!email) return;
    setState({ kind: 'sending' });
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: '/app',
      errorCallbackURL: '/sign-in?error=link',
    });
    if (error?.status === 429) {
      setState({ kind: 'error', message: 'Too many attempts. Please wait a minute and try again.' });
      return;
    }
    // Same message whether or not the address has an account (no account enumeration).
    setState({ kind: 'sent', email });
  }

  if (state.kind === 'sent') {
    return (
      <div className="space-y-4 text-center" role="status">
        <MailCheck aria-hidden className="mx-auto size-10 text-brand-deep" />
        <div className="space-y-1">
          <p className="font-semibold">Check your email</p>
          <p className="text-sm text-muted">
            If <strong className="text-ink">{state.email}</strong> has access, a one-time sign-in link is on its way. It
            expires in 15 minutes.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setState({ kind: 'idle' })}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}
      <Field label="Email address" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      <Button type="submit" size="lg" className="w-full" disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
