'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { confirmSetupAction, startSetupAction } from './actions';

type Step =
  | { kind: 'start' }
  | { kind: 'scan'; qrDataUrl: string; manualKey: string }
  | { kind: 'backup'; codes: string[] };

export function TwoFactorSetup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [error, setError] = useState<string | null>(null);
  const [codeErrors, setCodeErrors] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      const result = await startSetupAction();
      if (result.ok) setStep({ kind: 'scan', ...result.data });
      else setError(result.error.message);
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    setCodeErrors(undefined);
    startTransition(async () => {
      const result = await confirmSetupAction(code);
      if (result.ok) setStep({ kind: 'backup', codes: result.data.backupCodes });
      else setCodeErrors(result.error.fieldErrors?.code ?? [result.error.message]);
    });
  }

  if (step.kind === 'start') {
    return (
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Button onClick={begin} disabled={pending}>
          {pending ? 'Preparing…' : 'Set up two-step verification'}
        </Button>
      </div>
    );
  }

  if (step.kind === 'scan') {
    return (
      <div className="space-y-6">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open your authenticator app and add a new account.</li>
          <li>Scan this QR code, or type the key below.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data URL */}
          <img src={step.qrDataUrl} alt="QR code for your authenticator app" width={176} height={176} className="rounded-lg border border-line bg-white p-2" />
          <div>
            <p className="text-sm text-muted">Setup key</p>
            <code className="tabular text-base font-semibold tracking-wider">{step.manualKey}</code>
          </div>
        </div>
        <form onSubmit={confirm} className="max-w-xs space-y-3">
          <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} errors={codeErrors} />
          <Button type="submit" disabled={pending}>
            {pending ? 'Checking…' : 'Turn on'}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="success" title="Two-step verification is on">
        Save these backup codes somewhere safe. Each works once if you lose your phone. They won’t be shown again.
      </Alert>
      <ul className="tabular grid grid-cols-2 gap-2 rounded-lg border border-line bg-ground p-4 font-mono text-sm">
        {step.codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button onClick={() => router.refresh()}>I’ve saved my backup codes</Button>
    </div>
  );
}
