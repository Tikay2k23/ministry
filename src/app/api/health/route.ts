import { sql } from 'drizzle-orm';
import { logger } from '@/server/logger';
import { queryRows } from '@/server/db/client';
import { getDb } from '@/server/next/db';

/**
 * GET /api/health — for uptime monitoring and the post-deploy check (`npm run smoke`).
 * No authentication, so it says only whether the app can serve and reach its database: 200 with
 * `{ status: 'ok' }`, or 503 with `{ status: 'degraded' }`. Never any version, host or error
 * detail, which would tell an attacker what to try next. The System health page (/app/admin/health)
 * is the detailed view, and it needs a signed-in administrator.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await queryRows(getDb(), sql`SELECT 1`);
    return Response.json({ status: 'ok', database: 'ok', ms: Date.now() - startedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('Health check could not reach the database', error);
    return Response.json({ status: 'degraded', database: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
