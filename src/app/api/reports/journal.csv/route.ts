import { exportJournalReport } from '@/server/modules/reports/journal-reports.service';
import { portalCsvRoute } from '@/server/next/csv-route';
import { getDb } from '@/server/next/db';

/** GET /api/reports/journal.csv?kind=people|groups&from=&to=&leaderId=&view= */
export const GET = portalCsvRoute(async ({ ctx }, request) => {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return exportJournalReport(getDb(), ctx, params, params.kind === 'groups' ? 'groups' : 'people');
});
