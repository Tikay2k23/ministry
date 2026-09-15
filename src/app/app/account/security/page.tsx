import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { twoFactorStatus } from '@/server/modules/iam/two-factor.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { TwoFactorSetup } from './two-factor-setup';

export const metadata: Metadata = { title: 'My account' };

export default async function SecurityPage() {
  const { user } = await requirePortal();
  const status = await twoFactorStatus(getDb(), user.id);

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl">My account</h1>
        <p className="text-muted">
          {user.name} · {user.email}
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <h2 className="text-lg">Two-step verification</h2>
        {status.enabled ? (
          <div className="mt-4 flex items-start gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-6 text-brand-deep" />
            <div>
              <p className="font-medium">On — your account is protected with an authenticator app.</p>
              <p className="text-sm text-muted">
                {status.backupCodesLeft} backup code{status.backupCodesLeft === 1 ? '' : 's'} left.
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              Required for pastors, administrators and anyone who can read journals. Use an authenticator app such as
              Google Authenticator or Microsoft Authenticator.
            </p>
            <div className="mt-6">
              <TwoFactorSetup />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
