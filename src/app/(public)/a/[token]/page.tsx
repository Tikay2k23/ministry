import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Alert } from '@/components/ui/alert';
import { actionLinkPurpose } from '@/server/modules/devotional/action-links.service';
import { getServingByActionLink } from '@/server/modules/devotional/participation.service';
import { getSlotByActionLink } from '@/server/modules/prayer/participation.service';
import { issueFormSession } from '@/server/modules/public/participants.service';
import { getDb } from '@/server/next/db';
import { SlotCard } from '../../_prayer/slot-card';
import { ServingCard } from '../../_serving/serving-card';

// no-referrer: the token in this URL must never leak to other sites.
export const metadata: Metadata = { title: 'Your personal link', referrer: 'no-referrer' };

function LinkProblem({ coordinator }: { coordinator: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[28px] leading-tight">This link can’t be used</h1>
      <Alert tone="warning" title="It may have expired">
        Please ask your {coordinator} for a new link.
      </Alert>
    </div>
  );
}

/**
 * A personal link (docs/04 P7 prayer slot, P8 serving role). Opening it changes nothing, so chat
 * apps that preview links can't confirm anything by accident; every action is a button that POSTs
 * the token.
 */
export default async function PersonalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const now = new Date();
  const db = getDb();

  if ((await actionLinkPurpose(db, token)) === 'gathering_assignment') {
    const page = await getServingByActionLink(db, token, now);
    if (page.status === 'invalid') return <LinkProblem coordinator="worship coordinator" />;
    if (page.status === 'cancelled') {
      return (
        <div className="space-y-4">
          <h1 className="text-[28px] leading-tight">Thank you for being ready to serve</h1>
          <Alert tone="warning" title={`${page.gatheringName} on ${page.dateLabel} was cancelled`}>
            {page.reason}
          </Alert>
        </div>
      );
    }
    if (page.status === 'reassigned') {
      return (
        <div className="space-y-4">
          <h1 className="text-[28px] leading-tight">Thank you!</h1>
          <Alert tone="success" title="The roster has changed">
            Your coordinator has made a change to the roster for {page.gatheringName}. If you have a question, please ask them.
          </Alert>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-[28px] leading-tight">Hello, {page.firstName}!</h1>
          <p className="text-muted">Thank you for your heart to serve.</p>
        </div>
        <ServingCard token={token} initialView={page.view} />
      </div>
    );
  }

  const view = await getSlotByActionLink(db, token, now);
  if (view.status === 'invalid') return <LinkProblem coordinator="prayer coordinator" />;
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
