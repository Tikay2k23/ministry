import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '../db/client';
import { getEnv } from '../env';
import { AppError, HTTP_STATUS, isAppError } from '../errors';
import { logger } from '../logger';
import { resolveParticipantKey, type IssuedKey } from '../modules/public/participants.service';
import type { ParticipantIdentity, PublicRequest } from '../modules/public/public-request';
import { clientIp } from './context';
import { getDb } from './db';
import { isSameOrigin } from './route';

/**
 * JSON route handlers for the login-free public pages (docs/02a §3). Participants are
 * identified only by an HttpOnly device-key cookie; state-changing requests must come
 * from our own origin.
 */

const MAX_BODY_BYTES = 100_000;
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export function participantCookieName(): string {
  // __Host- cookies must be Secure, so the prefix is only used in production (HTTPS).
  return getEnv().NODE_ENV === 'production' ? '__Host-gt_pk' : 'gt_pk';
}

export interface PublicRoute {
  request: NextRequest;
  db: Database;
  req: PublicRequest;
  /** The participant behind this device's cookie, if any. */
  identity(): Promise<ParticipantIdentity | null>;
  /** Throws NOT_IDENTIFIED (and clears a stale cookie) when this device isn't recognised. */
  requireIdentity(): Promise<ParticipantIdentity>;
  /** The JSON object body of a mutation. */
  body(): Promise<Record<string, unknown>>;
  setKey(key: IssuedKey): void;
  clearKey(): void;
}

type CookieChange = { kind: 'set'; key: IssuedKey } | { kind: 'clear' } | null;

export function publicJsonRoute<T>(handler: (route: PublicRoute) => Promise<T>, options: { mutation?: boolean } = {}) {
  return async (request: NextRequest) => {
    let cookieChange: CookieChange = null;
    const secure = getEnv().NODE_ENV === 'production';

    const respond = (payload: unknown, status = 200) => {
      const response = NextResponse.json(payload, { status, headers: BASE_HEADERS });
      const change = cookieChange as CookieChange;
      if (change?.kind === 'set') {
        response.cookies.set(participantCookieName(), change.key.secret, {
          httpOnly: true,
          secure,
          sameSite: 'lax',
          path: '/',
          // Session keys ("This isn't my phone") end with the browser session.
          ...(change.key.persistent ? { expires: change.key.expiresAt } : {}),
        });
      } else if (change?.kind === 'clear') {
        response.cookies.set(participantCookieName(), '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
      }
      return response;
    };

    if (options.mutation && !isSameOrigin(request)) {
      return respond({ error: { code: 'FORBIDDEN', message: 'Please reload the page and try again.' } }, 403);
    }

    const db = getDb();
    const req: PublicRequest = {
      now: new Date(),
      ip: clientIp(request.headers) ?? null,
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id') ?? randomUUID(),
    };
    const cookieValue = request.cookies.get(participantCookieName())?.value;
    let resolved: Promise<ParticipantIdentity | null> | undefined;

    const route: PublicRoute = {
      request,
      db,
      req,
      identity: () => (resolved ??= resolveParticipantKey(db, cookieValue, req.now)),
      async requireIdentity() {
        const identity = await route.identity();
        if (!identity) {
          if (cookieValue) cookieChange = { kind: 'clear' };
          throw new AppError('NOT_IDENTIFIED', 'Please tell us who you are first.');
        }
        return identity;
      },
      async body() {
        if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
          throw new AppError('VALIDATION_ERROR', 'That is too long to send.');
        }
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 'That is too long to send.');
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
          // fall through
        }
        throw new AppError('VALIDATION_ERROR', 'Please reload the page and try again.');
      },
      setKey(key) {
        cookieChange = { kind: 'set', key };
      },
      clearKey() {
        cookieChange = { kind: 'clear' };
      },
    };

    try {
      return respond({ data: await handler(route) });
    } catch (error) {
      if (isAppError(error)) {
        return respond({ error: { code: error.code, message: error.message, ...error.details } }, HTTP_STATUS[error.code]);
      }
      logger.error('Unexpected error in a public route', error, { requestId: req.requestId, path: request.nextUrl.pathname });
      return respond({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } }, 500);
    }
  };
}

export function readFormSession(body: Record<string, unknown>): string | null {
  return typeof body.formSession === 'string' ? body.formSession : null;
}
