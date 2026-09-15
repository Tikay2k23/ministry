import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getEnv } from '@/server/env';
import { JOBS } from '@/server/modules/scheduler/jobs';
import { runDueJobs } from '@/server/modules/scheduler/scheduler.service';
import { getDb } from '@/server/next/db';

/**
 * GET or POST /api/cron/tick — for SCHEDULER_MODE=external (docs/02 §7, M3 note). An outside
 * scheduler calls this every 1–5 minutes with `Authorization: Bearer <CRON_SECRET>`. Without a
 * configured secret the endpoint doesn't exist.
 */
async function tick(request: NextRequest) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });

  const presented = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const results = await runDueJobs(getDb(), JOBS, new Date());
  return Response.json({ data: results }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = tick;
export const POST = tick;
