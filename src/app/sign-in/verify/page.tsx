import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPortalContext } from '@/server/next/context';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Two-step verification' };

export default async function VerifyPage() {
  const portal = await getPortalContext();
  if (!portal) redirect('/sign-in');
  if (!portal.needsSecondFactor) redirect('/app');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl">One more step</h1>
        <p className="text-sm text-muted">
          Enter the 6-digit code from your authenticator app, or one of your backup codes.
        </p>
      </div>
      <VerifyForm />
    </div>
  );
}
