import { getChainPage } from '@/server/modules/prayer/participation.service';
import { issueFormSession } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * GET /api/public/prayer/chain?code=XXXXXXXX[&scan=1] — the prayer chain page (docs/04 P6):
 * who is praying now and today's coverage for everyone, and their own slots for a remembered device.
 */
export const GET = publicJsonRoute(async ({ request, db, req, identity }) => {
  const params = request.nextUrl.searchParams;
  const page = await getChainPage(db, { code: params.get('code') ?? '', scan: params.get('scan') === '1' }, await identity(), req.now);
  return { ...page, formSession: issueFormSession(req.now) };
});
