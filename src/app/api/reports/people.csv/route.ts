import { exportPeopleDirectory } from '@/server/modules/reports/people-export.service';
import { portalCsvRoute } from '@/server/next/csv-route';
import { getDb } from '@/server/next/db';

/** GET /api/reports/people.csv?<directory filters> — the People page's current filters. */
export const GET = portalCsvRoute(async ({ ctx }, request) => {
  const { page: _page, ...filters } = Object.fromEntries(request.nextUrl.searchParams.entries());
  return exportPeopleDirectory(getDb(), ctx, filters);
});
