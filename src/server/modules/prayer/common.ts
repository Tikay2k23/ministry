import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import type { Executor } from '../../db/client';
import type { PrayerEventType } from '../../db/enums';
import { prayerAssignmentEvents, prayerChains } from '../../db/schema';
import { notFound } from '../../errors';
import { assertChainAccess } from '../../policy/can';
import type { PermissionKey } from '../../policy/catalog';
import { localDate } from '../journal/journal-dates';

/** Shared helpers for the prayer chain module (docs/03 §4.11, docs/05 W10–W14). */

export const PRAYER_REPORT_FORM_KEY = 'prayer_report';

export type ChainRow = typeof prayerChains.$inferSelect;

export type EventActor = { type: 'user'; userId: string } | { type: 'participant' } | { type: 'system' };

export function actorFromContext(ctx: RequestContext): EventActor {
  if (ctx.actor.kind === 'user') return { type: 'user', userId: ctx.actor.userId };
  if (ctx.actor.kind === 'participant') return { type: 'participant' };
  return { type: 'system' };
}

export async function loadChain(executor: Executor, chainId: string, options: { forUpdate?: boolean } = {}): Promise<ChainRow | null> {
  if (!z.uuid().safeParse(chainId).success) return null;
  const query = executor
    .select()
    .from(prayerChains)
    .where(and(eq(prayerChains.id, chainId), isNull(prayerChains.archivedAt)));
  const [chain] = options.forUpdate ? await query.for('update') : await query;
  return chain ?? null;
}

/** Loads a chain the actor may act on with `permission`; otherwise NOT_FOUND (docs/06 T14). */
export async function chainForActor(
  executor: Executor,
  ctx: RequestContext,
  permission: PermissionKey,
  chainId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ChainRow> {
  const chain = await loadChain(executor, chainId, options);
  if (!chain) throw notFound('prayer chain');
  assertChainAccess(ctx, permission, { id: chain.id, ministryId: chain.ministryId });
  return chain;
}

export const chainToday = (chain: Pick<ChainRow, 'timezone'>, now: Date) => localDate(now, chain.timezone);

export async function recordPrayerEvent(
  executor: Executor,
  input: {
    assignmentId: string;
    eventType: PrayerEventType;
    actor: EventActor;
    via: 'action_link' | 'chain_page' | 'portal' | 'job';
    at: Date;
    note?: string | null;
  },
) {
  await executor.insert(prayerAssignmentEvents).values({
    assignmentId: input.assignmentId,
    eventType: input.eventType,
    occurredAt: input.at,
    actorType: input.actor.type,
    actorUserId: input.actor.type === 'user' ? input.actor.userId : null,
    via: input.via,
    note: input.note ?? null,
  });
}

export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 06:00');

export const later = (a: string, b: string) => (a > b ? a : b);
export const earlier = (a: string, b: string) => (a < b ? a : b);
