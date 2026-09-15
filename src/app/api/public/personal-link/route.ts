import { installPersonalLink } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * POST /api/public/personal-link — uses a single-use personal link from a leader.
 * A POST (not the page GET) so link previews in chat apps can't use the link up.
 */
export const POST = publicJsonRoute(
  async ({ db, req, body, setKey }) => {
    const result = await installPersonalLink(db, req, await body());
    setKey(result.key);
    return { firstName: result.firstName };
  },
  { mutation: true },
);
