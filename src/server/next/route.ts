import 'server-only';
import { NextResponse } from 'next/server';
import { getEnv } from '../env';
import { HTTP_STATUS, isAppError } from '../errors';
import { logger } from '../logger';
import { getPortalContext, type PortalContext } from './context';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * JSON route handler for signed-in portal users (docs/02a §1). Unauthenticated or
 * second-factor-pending sessions get 401; AppErrors map to their HTTP status; anything
 * else is logged and returned as a generic 500.
 */
export function portalJsonRoute<T>(handler: (portal: PortalContext, request: Request) => Promise<T>) {
  return async (request: Request) => {
    const portal = await getPortalContext();
    if (!portal || portal.needsSecondFactor) {
      return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }, { status: 401, headers: NO_STORE });
    }
    try {
      return NextResponse.json({ data: await handler(portal, request) }, { headers: NO_STORE });
    } catch (error) {
      if (isAppError(error)) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, ...error.details } },
          { status: HTTP_STATUS[error.code], headers: NO_STORE },
        );
      }
      logger.error('Unexpected error in a portal route', error, { path: new URL(request.url).pathname });
      return NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, { status: 500, headers: NO_STORE });
    }
  };
}

/** CSRF guard for state-changing route handlers: the Origin must be our own app. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(getEnv().APP_URL).host;
  } catch {
    return false;
  }
}
