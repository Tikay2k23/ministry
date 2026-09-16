import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Alert } from '@/components/ui/alert';
import { getSlotByActionLink } from '@/server/modules/prayer/participation.service';
import { issueFormSession } from '@/server/modules/public/participants.service';
import { getDb } from '@/server/next/db';
import { SlotCard } from '../../_prayer/slot-card';

// no-referrer: the token in this URL must never leak to other sites.
export const metadata: Metadata = { title: 'Your prayer slot', referrer: 'no-referrer' };

/**
 * A personal prayer link (docs/04 P7). Opening it changes nothing, so chat apps that preview
 * links can't confirm a slot by accident; every action is a button that POSTs the token.
 */
export default async function PrayerSlotPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const now = new Date();
  const view = await getSlotByActionLink(getDb(), token, now);

  if (view.status === 'invalid') {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] leading-tight">This link can’t be used</h1>
        <Alert tone="warning" title="It may have expired">
          Please ask your prayer coordinator for a new link.
        </Alert>
      </div>
    );
  }

  if (view.status === 'reassigned') {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] leading-tight">Thank you!</h1>
        <Alert tone="success" title="This slot has been reassigned">
          Your coordinator has made a change to this slot in {view.chainName}. If you have a question, please ask them.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-tight">Hello, {view.firstName}!</h1>
        <p className="text-muted">Thank you for standing in the gap in prayer.</p>
      </div>
      <SlotCard actor={{ token }} initialSlot={view.slot} initialReport={view.report} formSession={issueFormSession(now)} />
    </div>
  );
}
