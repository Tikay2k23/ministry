import { exportPrayerReport } from '@/server/modules/reports/prayer-reports.service';
import { portalCsvRoute } from '@/server/next/csv-route';
import { getDb } from '@/server/next/db';

/** GET /api/reports/prayer.csv?tab=days|people&chainId=&from=&to= */
export const GET = portalCsvRoute(async ({ ctx }, request) => {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return exportPrayerReport(getDb(), ctx, params, params.tab === 'people' ? 'people' : 'days');
});
