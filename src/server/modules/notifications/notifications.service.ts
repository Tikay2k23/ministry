import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { notifications } from '../../db/schema';
import { AppError } from '../../errors';
import { parseInput } from '../../validation';
import { templateFor, type TemplateKey } from './templates';

/**
 * Notification intents (docs/02 §6): one row per logical message, idempotent by dedupe key.
 * Delivery happens in the `notifications.deliver` job; portal users also read them in-app.
 */

export interface QueueNotificationInput {
  templateKey: TemplateKey;
  recipientPersonId?: string | null;
  recipientUserId?: string | null;
  payload: Record<string, string | number | boolean | null>;
  /** e.g. `prayer_slot_reminder:{assignmentId}:24h` — the same key is never queued twice. */
  dedupeKey: string;
  scheduledFor?: Date;
}

export async function queueNotification(executor: Executor, input: QueueNotificationInput): Promise<boolean> {
  const template = templateFor(input.templateKey)!;
  const inserted = await executor
    .insert(notifications)
    .values({
      category: template.category,
      templateKey: input.templateKey,
      recipientPersonId: input.recipientPersonId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  return inserted.length > 0;
}

// ─── In-app inbox ─────────────────────────────────────────────────────────────

const INBOX_PAGE_SIZE = 30;

function requireUser(ctx: RequestContext): string {
  const userId = actorUserId(ctx);
  if (!userId) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  return userId;
}

export const InboxInput = z.object({
  unreadOnly: z.preprocess((v) => v === true || v === '1' || v === 'true', z.boolean()),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export async function listInbox(db: Database, ctx: RequestContext, raw: unknown) {
  const userId = requireUser(ctx);
  const { unreadOnly, page } = parseInput(InboxInput, raw ?? {});
  const where = and(eq(notifications.recipientUserId, userId), unreadOnly ? isNull(notifications.readAt) : undefined);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        templateKey: notifications.templateKey,
        payload: notifications.payload,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(where)
      // Unread first (docs/04 A24), newest first within each.
      .orderBy(sql`${notifications.readAt} IS NULL DESC`, desc(notifications.createdAt), desc(notifications.id))
      .limit(INBOX_PAGE_SIZE)
      .offset((page - 1) * INBOX_PAGE_SIZE),
    db
      .select({
        total: count(),
        unread: sql<number>`count(*) FILTER (WHERE ${notifications.readAt} IS NULL)`.mapWith(Number),
      })
      .from(notifications)
      .where(where),
  ]);

  return {
    items: rows.map((row) => {
      const content = templateFor(row.templateKey)?.render(row.payload as Record<string, unknown>) ?? { title: 'Notification', body: '' };
      return {
        id: row.id,
        title: content.title,
        body: content.body,
        portalPath: content.portalPath ?? null,
        actionLabel: content.actionLabel ?? null,
        createdAt: row.createdAt,
        readAt: row.readAt,
      };
    }),
    total: totals?.total ?? 0,
    unread: totals?.unread ?? 0,
    page,
    pageSize: INBOX_PAGE_SIZE,
  };
}

export async function countUnreadNotifications(db: Executor, ctx: RequestContext): Promise<number> {
  const userId = actorUserId(ctx);
  if (!userId) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export const MarkReadInput = z.union([z.object({ ids: z.array(z.uuid()).min(1).max(100) }), z.object({ all: z.literal(true) })]);

export async function markNotificationsRead(db: Database, ctx: RequestContext, raw: unknown) {
  const userId = requireUser(ctx);
  const input = parseInput(MarkReadInput, raw);
  const updated = await db
    .update(notifications)
    .set({ readAt: ctx.now })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        isNull(notifications.readAt),
        'ids' in input ? inArray(notifications.id, input.ids) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return { marked: updated.length };
}
