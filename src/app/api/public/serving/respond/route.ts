import { respondToServing } from '@/server/modules/devotional/participation.service';
import { publicJsonRoute } from '@/server/next/public-route';

/** POST /api/public/serving/respond — "I'll be there" or "I can't make it" from a personal serving link (docs/05 W9). */
export const POST = publicJsonRoute(async ({ db, req, body }) => respondToServing(db, req, await body()), { mutation: true });
