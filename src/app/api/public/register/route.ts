import { assertFormSession, registerParticipant } from '@/server/modules/public/participants.service';
import { publicJsonRoute, readFormSession } from '@/server/next/public-route';

/** POST /api/public/register — "I'm new": registers an unconfirmed person under the chosen leader. */
export const POST = publicJsonRoute(
  async ({ db, req, body, setKey }) => {
    const input = await body();
    assertFormSession(readFormSession(input), req.now, { minFillMs: 4_000 });
    const result = await registerParticipant(db, req, input);
    setKey(result.key);
    return { firstName: result.firstName, leaderName: result.leaderName };
  },
  { mutation: true },
);
