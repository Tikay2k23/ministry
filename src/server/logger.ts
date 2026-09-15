/**
 * Structured server logs (docs/02 §8.1: PII-scrubbing in logs and Sentry).
 *
 * - Production and tests: one JSON object per line, which Vercel and log drains index.
 * - Development: a readable line plus the raw error, for debugging on your own machine.
 *
 * Errors are reduced to what helps debugging without personal data. Database errors keep the SQL
 * text, the PostgreSQL code and the constraint name, but never the bound values (Drizzle repeats
 * them in its error message) or PostgreSQL's `detail` line (which repeats the row's values).
 * Unexpected errors also go to the error reporter — Sentry, when SENTRY_DSN is set
 * (src/instrumentation.ts) — which scrubs events the same way before sending them.
 */

export type LogFields = Record<string, unknown>;
export type ErrorReporter = (error: unknown, context: LogFields) => void;

const SENSITIVE_KEY = /email|phone|token|secret|password|authorization|cookie|answer|content|note|address/i;
const MAX_TEXT = 500;

let reporter: ErrorReporter | null = null;

/** Where unexpected errors are reported besides the log (Sentry). */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

const truncate = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

/** Some PostgreSQL messages quote the offending input, e.g. `invalid input syntax for type uuid: "…"`. */
const withoutQuotedValues = (text: string) => text.replace(/"[^"]*"/g, '"…"');

type ErrorLike = Record<string, unknown>;

const isPostgresError = (e: ErrorLike) => typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code);

/** A description of an error that is safe to log: no bound values and no row data. */
export function describeError(error: unknown, depth = 0): LogFields {
  if (typeof error !== 'object' || error === null) return { message: truncate(String(error)) };
  const e = error as ErrorLike;
  const described: LogFields = { name: typeof e.name === 'string' ? e.name : 'Error' };

  if (typeof e.query === 'string' && 'params' in e) {
    // DrizzleQueryError: its message repeats the parameters, so keep only the SQL.
    described.query = truncate(e.query);
  } else if (isPostgresError(e)) {
    described.code = e.code;
    for (const key of ['constraint', 'table', 'column'] as const) {
      if (typeof e[key] === 'string') described[key] = e[key];
    }
    if (typeof e.message === 'string') described.message = truncate(withoutQuotedValues(e.message));
  } else if (typeof e.message === 'string') {
    described.message = truncate(e.message);
  }

  if (typeof e.stack === 'string') {
    // Only the frames: the first line of a stack repeats the message.
    described.stack = e.stack
      .split('\n')
      .filter((line) => line.trimStart().startsWith('at '))
      .slice(0, 10)
      .join('\n');
  }
  if (e.cause !== undefined && depth < 2) described.cause = describeError(e.cause, depth + 1);
  return described;
}

/** One line that is safe to store or show to administrators, e.g. a job's last error in System health. */
export function errorSummary(error: unknown): string {
  const described = describeError(error);
  const failedQuery = described.query !== undefined;
  const source =
    failedQuery && typeof described.cause === 'object' && described.cause !== null ? (described.cause as LogFields) : described;
  const label = failedQuery ? 'Database query failed' : String(described.name);
  const code =
    typeof source.code === 'string' ? ` [${source.code}${typeof source.constraint === 'string' ? ` ${source.constraint}` : ''}]` : '';
  const message = typeof source.message === 'string' ? `: ${source.message}` : '';
  return truncate(`${label}${code}${message}`);
}

function scrub(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : value]));
}

function write(level: 'info' | 'warn' | 'error', message: string, fields: LogFields, error?: unknown) {
  const print = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  if (process.env.NODE_ENV === 'development') {
    print(`[${level}] ${message}`, ...(Object.keys(fields).length > 0 ? [fields] : []), ...(error === undefined ? [] : [error]));
    return;
  }
  const entry = { level, time: new Date().toISOString(), msg: message, ...fields, ...(error === undefined ? {} : { error: describeError(error) }) };
  let line: string;
  try {
    line = JSON.stringify(entry, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
  } catch {
    line = JSON.stringify({ level, time: entry.time, msg: message });
  }
  print(line);
}

export const logger = {
  info(message: string, fields?: LogFields) {
    write('info', message, scrub(fields));
  },
  warn(message: string, fields?: LogFields) {
    write('warn', message, scrub(fields));
  },
  /** Something unexpected failed: logged without personal data, and reported. */
  error(message: string, error?: unknown, fields?: LogFields) {
    const context = scrub(fields);
    write('error', message, context, error);
    if (error !== undefined && reporter) {
      try {
        reporter(error, { message, ...context });
      } catch {
        // Reporting must never break the request that failed.
      }
    }
  },
};
