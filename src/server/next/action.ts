import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { fail, isAppError, ok, type Result } from '../errors';
import { logger } from '../logger';

/**
 * Runs a server-action body and converts expected failures (AppError) into a Result the
 * client can render. Unexpected errors are logged and returned as a generic INTERNAL error
 * so no internal details reach the browser. Next.js redirects/notFound are re-thrown.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await body());
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) return fail(error);
    logger.error('Unexpected error in a server action', error);
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  }
}
