import { getProofView } from '@/server/modules/journal/proof.service';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/**
 * GET /api/journal/proof/{attachmentId} — a link to one journal photo, for a leader or pastor.
 *
 * The link is made only after the policy layer has agreed (`journal.proof.view` over that person),
 * and it stops working after a minute, so it is useless if it is copied or ends up in a history.
 * The look is recorded in the access log. An id that doesn't exist, one that isn't attached to a
 * journal, and one this person may not see all answer the same way.
 */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const attachmentId = new URL(request.url).pathname.split('/').pop();
  return getProofView(getDb(), ctx, { attachmentId });
});
