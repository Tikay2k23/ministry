import { getVisiblePath } from '@/server/modules/hierarchy/hierarchy.queries';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/** Ancestor ids (within the caller's scope) used by the tree explorer to jump to a person. */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const personId = new URL(request.url).searchParams.get('personId') ?? '';
  return getVisiblePath(getDb(), ctx, personId);
});
