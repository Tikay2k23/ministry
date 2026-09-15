'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi } from '../../_lib/public-api';

export function PersonalLinkConfirm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await callApi<{ firstName: string }>('POST', '/api/public/personal-link', { token, rememberDevice: remember });
      if (result.ok) {
        // replace: the used link shouldn't stay in the back history.
        router.replace('/j');
        return;
      }
      setError(result.error.message);
    });
  };

  return (
    <form onSubmit={confirm} className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-[28px] leading-tight">Welcome, {name}</h1>
        <p>This link sets up this phone for your Daily Journal, so you don’t need to sign in.</p>
      </div>
      <div className="flex items-start gap-3">
        <input
          id="remember"
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          aria-describedby="remember-hint"
          className="mt-1 size-5 shrink-0 accent-brand-deep"
        />
        <div>
          <label htmlFor="remember">Remember me on this phone</label>
          <p id="remember-hint" className="text-base text-muted">
            Untick this on a shared or borrowed phone.
          </p>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Setting up…' : 'Continue to my journal'}
      </Button>
      <p className="text-base text-muted">Not {name}? Close this page and let your leader know.</p>
    </form>
  );
}
