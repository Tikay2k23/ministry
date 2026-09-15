import { listTreeChildren, listTreeRoots } from '@/server/modules/hierarchy/hierarchy.queries';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/** Lazy tree loading for the leadership explorer (roots when no parentId). */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const parentId = new URL(request.url).searchParams.get('parentId');
  return parentId ? listTreeChildren(getDb(), ctx, parentId) : listTreeRoots(getDb(), ctx);
});
