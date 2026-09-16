import { submitReportFromChainPage, submitReportWithActionLink } from '@/server/modules/prayer/participation.service';
import { assertFormSession } from '@/server/modules/public/participants.service';
import { publicJsonRoute, readFormSession } from '@/server/next/public-route';

/** POST /api/public/prayer/report — the optional prayer report, testimony or prayer request after a slot (docs/05 W12 step 6). */
export const POST = publicJsonRoute(
  async ({ db, req, body, requireIdentity }) => {
    const input = await body();
    assertFormSession(readFormSession(input), req.now);
    if (typeof input.token === 'string') return submitReportWithActionLink(db, req, input);
    return submitReportFromChainPage(db, await requireIdentity(), req, input);
  },
  { mutation: true },
);
