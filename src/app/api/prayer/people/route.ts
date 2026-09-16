import { searchAssignablePeople } from '@/server/modules/prayer/assignments.service';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/** Typeahead for putting people on prayer slots: names and person codes only (docs/06 note j). */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const params = new URL(request.url).searchParams;
  return searchAssignablePeople(getDb(), ctx, { chainId: params.get('chainId') ?? '', q: params.get('q') ?? '' });
});
