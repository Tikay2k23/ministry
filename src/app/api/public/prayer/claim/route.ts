import { claimSlot } from '@/server/modules/prayer/participation.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * POST /api/public/prayer/claim — take an open hour from the chain page, or move to another one
 * (docs/05 W11 self sign-up). The body names an hour, never a person: who is asking comes from the
 * remembered device, and every rule is re-checked on the server.
 */
export const POST = publicJsonRoute(
  async ({ db, req, body, requireIdentity }) => {
    const input = await body();
    return claimSlot(db, await requireIdentity(), req, input);
  },
  { mutation: true },
);
