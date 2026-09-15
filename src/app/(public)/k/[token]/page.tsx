import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Alert } from '@/components/ui/alert';
import { inspectPersonalLink } from '@/server/modules/public/participants.service';
import { getDb } from '@/server/next/db';
import { PersonalLinkConfirm } from './personal-link-confirm';

// no-referrer: the token in this URL must never leak to other sites.
export const metadata: Metadata = { title: 'Your journal link', referrer: 'no-referrer' };

/**
 * A personal link from a leader. Opening the page does nothing by itself (so chat-app link
 * previews can't use it up); the person confirms with a button, which POSTs the token.
 */
export default async function PersonalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = await inspectPersonalLink(getDb(), token, new Date());

  if (!link.valid) {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] leading-tight">This link can’t be used</h1>
        <Alert tone="warning" title="It may have expired or already been used">
          Please ask your leader to send you a new personal link.
        </Alert>
        <p>
          Journaled before?{' '}
          <Link href="/j" className="font-semibold text-brand-deep underline underline-offset-2">
            Go to the Daily Journal
          </Link>
        </p>
      </div>
    );
  }

  return <PersonalLinkConfirm token={token} name={link.name} />;
}
