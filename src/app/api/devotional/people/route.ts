import { searchServingPeople } from '@/server/modules/devotional/roster.service';
import { searchPeopleForTeam } from '@/server/modules/devotional/teams.service';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/**
 * Typeahead for rosters (`gatheringId`, optional `servingRoleId`) and worship teams (`teamId`):
 * names and person codes only (docs/06 note j).
 */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const params = new URL(request.url).searchParams;
  const q = params.get('q') ?? '';
  const teamId = params.get('teamId');
  if (teamId) return searchPeopleForTeam(getDb(), ctx, { teamId, q });
  return searchServingPeople(getDb(), ctx, {
    gatheringId: params.get('gatheringId') ?? '',
    servingRoleId: params.get('servingRoleId') || undefined,
    q,
  });
});
