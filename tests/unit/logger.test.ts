import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, errorSummary, logger, setErrorReporter } from '@/server/logger';

const postgresError = (fields: Record<string, string>) => Object.assign(new Error(fields.message), fields);

const drizzleQueryError = (query: string, params: unknown[], cause: unknown) =>
  Object.assign(new Error(`Failed query: ${query}\nparams: ${params.join(', ')}`), { name: 'DrizzleQueryError', query, params, cause });

describe('structured logging', () => {
  afterEach(() => {
    setErrorReporter(null);
    vi.restoreAllMocks();
  });

  it('keeps the SQL of a failed query but never its values or the row detail', () => {
    const cause = postgresError({
      message: 'duplicate key value violates unique constraint "people_phone_unique"',
      code: '23505',
      constraint: 'people_phone_unique',
      detail: 'Key (phone_e164)=(+639171234567) already exists.',
    });
    const error = drizzleQueryError('insert into "people" ("phone_e164") values ($1)', ['+639171234567'], cause);

    const logged = JSON.stringify(describeError(error));
    expect(logged).toContain('insert into');
    expect(logged).toContain('23505');
    expect(logged).not.toContain('+639171234567');
    expect(errorSummary(error)).toBe('Database query failed [23505 people_phone_unique]: duplicate key value violates unique constraint "…"');
  });

  it('hides input that PostgreSQL quotes back in its message', () => {
    const error = postgresError({ message: 'invalid input syntax for type uuid: "juan@example.org"', code: '22P02' });
    expect(JSON.stringify(describeError(error))).not.toContain('juan@example.org');
  });

  it('writes one JSON line with sensitive fields redacted, and reports the error', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      lines.push(line);
    });
    const reported: unknown[] = [];
    setErrorReporter((error) => reported.push(error));

    logger.error('Background job failed', new Error('boom'), { job: 'tokens.cleanup', email: 'juan@example.org' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'error',
      msg: 'Background job failed',
      job: 'tokens.cleanup',
      email: '[redacted]',
      error: { name: 'Error', message: 'boom' },
    });
    expect(reported).toHaveLength(1);
  });
});
