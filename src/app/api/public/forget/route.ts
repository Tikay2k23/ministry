import { forgetParticipantKey } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/** POST /api/public/forget — "Not you?": this device stops remembering the person. */
export const POST = publicJsonRoute(
  async ({ db, req, identity, clearKey }) => {
    const who = await identity();
    if (who) await forgetParticipantKey(db, who, req.now);
    clearKey();
    return { forgotten: true };
  },
  { mutation: true },
);
