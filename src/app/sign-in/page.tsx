import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { getPortalContext } from '@/server/next/context';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const portal = await getPortalContext();
  if (portal) redirect(portal.needsSecondFactor ? '/sign-in/verify' : '/app');
  const { error } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl">Welcome</h1>
        <p className="text-sm text-muted">Sign in with the email address your ministry office invited. No password needed.</p>
      </div>
      {error && (
        <Alert tone="error" title="That sign-in link didn’t work">
          It may have expired or already been used. Request a new one below.
        </Alert>
      )}
      <SignInForm />
    </div>
  );
}
