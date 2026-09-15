import { searchPeopleForPicker } from '@/server/modules/people/people.queries';
import { getDb } from '@/server/next/db';
import { portalJsonRoute } from '@/server/next/route';

/** Typeahead for person pickers. Results are always limited to the caller's scope. */
export const GET = portalJsonRoute(async ({ ctx }, request) => {
  const params = new URL(request.url).searchParams;
  return searchPeopleForPicker(getDb(), ctx, {
    q: params.get('q') ?? '',
    placedOnly: params.get('placed') === '1',
    permission: (params.get('permission') ?? undefined) as 'people.view' | undefined,
  });
});
