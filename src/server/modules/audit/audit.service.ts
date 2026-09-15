import { isIP } from 'node:net';
import type { RequestContext } from '../../context/request-context';
import type { Executor } from '../../db/client';
import type { AuditCategory } from '../../db/enums';
import { auditLogs } from '../../db/schema';

export interface AuditEntry {
  category: AuditCategory;
  /** Dotted verb, e.g. 'person.created', 'hierarchy.moved', 'journal.content_viewed'. */
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  /** Justification for sensitive actions (break-glass, reassignment reason). */
  reason?: string | null;
}

/**
 * Appends an audit record. Call inside the same transaction as the change it describes,
 * so a rolled-back change never leaves a phantom audit row (and vice versa).
 * Never pass journal content, prayer requests or pastoral notes in old/new values.
 */
export async function recordAudit(executor: Executor, ctx: RequestContext, entry: AuditEntry): Promise<void> {
  const actor = ctx.actor;
  await executor.insert(auditLogs).values({
    category: entry.category,
    action: entry.action,
    actorType: actor.kind === 'user' ? 'user' : actor.kind === 'system' ? 'system' : 'participant',
    actorUserId: actor.kind === 'user' ? actor.userId : null,
    actorPersonId: actor.kind === 'user' || actor.kind === 'participant' ? actor.personId : null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary ?? null,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    reason: entry.reason ?? null,
    requestId: ctx.requestId,
    ip: ctx.ip && isIP(ctx.ip) ? ctx.ip : null,
    userAgent: ctx.userAgent?.slice(0, 500) ?? null,
  });
}

/** Returns only the fields that changed, as `{ old, new }` value maps for the audit log. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { oldValues: Partial<T>; newValues: Partial<T> } | null {
  const oldValues: Partial<T> = {};
  const newValues: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const a = before[key];
    const b = after[key];
    if (b === undefined) continue;
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) {
      oldValues[key] = a;
      newValues[key] = b;
    }
  }
  return Object.keys(newValues).length ? { oldValues, newValues } : null;
}
