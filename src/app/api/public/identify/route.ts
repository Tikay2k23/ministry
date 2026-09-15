import { assertFormSession, identifyParticipant } from '@/server/modules/public/participants.service';
import { publicJsonRoute, readFormSession } from '@/server/next/public-route';

/** POST /api/public/identify — "I've journaled before": mobile number + first name. */
export const POST = publicJsonRoute(
  async ({ db, req, body, setKey }) => {
    const input = await body();
    assertFormSession(readFormSession(input), req.now);
    const result = await identifyParticipant(db, req, input);
    if (result.result === 'identified') {
      setKey(result.key);
      return { result: result.result, firstName: result.firstName };
    }
    return result;
  },
  { mutation: true },
);
