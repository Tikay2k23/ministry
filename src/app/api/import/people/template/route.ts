import { PEOPLE_IMPORT_TEMPLATE } from '@/server/modules/import/people-import.parse';
import { getPortalContext } from '@/server/next/context';

export async function GET() {
  const portal = await getPortalContext();
  if (!portal) return new Response('Please sign in.', { status: 401 });
  return new Response(`﻿${PEOPLE_IMPORT_TEMPLATE}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gentouch-people-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
