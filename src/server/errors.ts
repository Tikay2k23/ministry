/** Error codes shared by services, server actions and route handlers (docs/02a §1). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_IDENTIFIED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'CHALLENGE_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'INTERNAL';

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  NOT_IDENTIFIED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  CHALLENGE_REQUIRED: 428,
  STEP_UP_REQUIRED: 401,
  INTERNAL: 500,
};

export interface ErrorDetails {
  fieldErrors?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}

/** An expected, user-presentable failure. Anything else is an INTERNAL error. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Out-of-scope records look exactly like missing ones (BR-A-03). */
export const notFound = (what = 'record') => new AppError('NOT_FOUND', `We couldn't find that ${what}.`);

export const forbidden = (message = "You don't have permission to do that.") =>
  new AppError('FORBIDDEN', message);

export const conflict = (message: string, meta?: Record<string, unknown>) =>
  new AppError('CONFLICT', message, { meta });

export const invalidState = (message: string, meta?: Record<string, unknown>) =>
  new AppError('INVALID_STATE', message, { meta });

export const validationError = (fieldErrors: Record<string, string[]>, message = 'Please check the highlighted fields.') =>
  new AppError('VALIDATION_ERROR', message, { fieldErrors });

export interface Warning {
  code: string;
  message: string;
}

export type Result<T> =
  | { ok: true; data: T; warnings?: Warning[] }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; meta?: Record<string, unknown> } };

export const ok = <T>(data: T, warnings?: Warning[]): Result<T> => (warnings?.length ? { ok: true, data, warnings } : { ok: true, data });

export function fail(error: AppError): Result<never> {
  return {
    ok: false,
    error: { code: error.code, message: error.message, ...error.details },
  };
}
