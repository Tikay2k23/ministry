import { respondFromChainPage, respondWithActionLink } from '@/server/modules/prayer/participation.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * POST /api/public/prayer/respond — confirm, "I'm praying now", "I've finished praying" or
 * "I can't make it" (docs/05 W12), with a personal link (`token`) or from a remembered device
 * (`assignmentId`).
 */
export const POST = publicJsonRoute(
  async ({ db, req, body, requireIdentity }) => {
    const input = await body();
    if (typeof input.token === 'string') return respondWithActionLink(db, req, input);
    return respondFromChainPage(db, await requireIdentity(), req, input);
  },
  { mutation: true },
);
