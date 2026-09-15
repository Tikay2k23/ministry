import 'server-only';
import type { NextRequest } from 'next/server';
import { HTTP_STATUS, isAppError } from '../errors';
import { logger } from '../logger';
import { getPortalContext, type PortalContext } from './context';

/**
 * GET route handler that returns a CSV download for a signed-in portal user. Authorisation
 * happens in the service (permissions, scope, audit); errors come back as plain text.
 */
export function portalCsvRoute(handler: (portal: PortalContext, request: NextRequest) => Promise<{ filename: string; csv: string }>) {
  return async (request: NextRequest) => {
    const text = (body: string, status: number) =>
      new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

    const portal = await getPortalContext();
    if (!portal || portal.needsSecondFactor) return text('Please sign in.', 401);
    try {
      const { filename, csv } = await handler(portal, request);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (isAppError(error)) return text(error.message, HTTP_STATUS[error.code]);
      logger.error('Unexpected error in a CSV export', error, { path: request.nextUrl.pathname });
      return text('Something went wrong. Please try again.', 500);
    }
  };
}
