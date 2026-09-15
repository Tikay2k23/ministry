import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { RequestContext } from '../context/request-context';
import { queryRows, type Executor } from '../db/client';
import { columnRef } from '../db/sql-helpers';
import { AppError, forbidden, notFound } from '../errors';
import type { PermissionKey } from './catalog';
import type { Grant, Scope } from './grants';

/**
 * Authorisation primitives (docs/06 §5). Deny by default: anything that is not a
 * portal user with a matching grant gets nothing here. Participant capabilities are
 * handled by the public modules, never by grants.
 */

export function grantsFor(ctx: RequestContext, permission: PermissionKey): Grant[] {
  if (ctx.actor.kind !== 'user') return [];
  return ctx.actor.grants.filter((g) => g.permission === permission);
}

export function hasPermission(ctx: RequestContext, permission: PermissionKey): boolean {
  return grantsFor(ctx, permission).length > 0;
}

export function hasGlobal(ctx: RequestContext, permission: PermissionKey): boolean {
  return grantsFor(ctx, permission).some((g) => g.scope.type === 'global');
}

/** For actions that are not about one specific record (e.g. opening the settings page). */
export function assertPermission(ctx: RequestContext, permission: PermissionKey): void {
  if (ctx.actor.kind !== 'user') throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  if (!hasPermission(ctx, permission)) throw forbidden();
}

export function assertGlobal(ctx: RequestContext, permission: PermissionKey): void {
  assertPermission(ctx, permission);
  if (!hasGlobal(ctx, permission)) throw forbidden();
}

function scopeCondition(scope: Scope, personId: SQL | AnyPgColumn): SQL {
  // Always qualified: an unqualified outer column inside these subqueries could bind to the
  // subquery's own table and silently widen access (see db/sql-helpers.ts).
  const ref = columnRef(personId);
  switch (scope.type) {
    case 'global':
      return sql`TRUE`;
    case 'branch':
      return sql`EXISTS (SELECT 1 FROM hierarchy_closure hc
        WHERE hc.ancestor_id = ${scope.anchorPersonId} AND hc.descendant_id = ${ref}
        ${scope.maxDepth === null ? sql`` : sql`AND hc.depth <= ${scope.maxDepth}`})`;
    case 'ministry':
      return sql`EXISTS (SELECT 1 FROM ministry_memberships mm
        WHERE mm.ministry_id = ${scope.ministryId} AND mm.person_id = ${ref} AND mm.ended_on IS NULL)`;
    case 'team':
      return sql`EXISTS (SELECT 1 FROM team_memberships tm
        WHERE tm.team_id = ${scope.teamId} AND tm.person_id = ${ref} AND tm.left_on IS NULL)`;
    case 'prayer_chain':
      // People-based permissions over a chain reach its participants: anyone with an assignment
      // or an active standing commitment in that chain.
      return sql`(EXISTS (SELECT 1 FROM prayer_assignments pa JOIN prayer_slots ps ON ps.id = pa.slot_id
          WHERE ps.prayer_chain_id = ${scope.chainId} AND pa.person_id = ${ref})
        OR EXISTS (SELECT 1 FROM prayer_commitments pc
          WHERE pc.prayer_chain_id = ${scope.chainId} AND pc.person_id = ${ref} AND pc.ended_at IS NULL))`;
  }
}

/**
 * SQL predicate restricting a query to people within any scope that grants `permission`.
 * List queries use this so out-of-scope rows are never selected (no in-memory filtering).
 */
export function personScopeFilter(
  ctx: RequestContext,
  permission: PermissionKey,
  personId: SQL | AnyPgColumn,
): SQL {
  const grants = grantsFor(ctx, permission);
  if (grants.length === 0) return sql`FALSE`;
  if (grants.some((g) => g.scope.type === 'global')) return sql`TRUE`;
  return sql`(${sql.join(
    grants.map((g) => scopeCondition(g.scope, personId)),
    sql` OR `,
  )})`;
}

export async function canAccessPerson(
  executor: Executor,
  ctx: RequestContext,
  permission: PermissionKey,
  personId: string,
): Promise<boolean> {
  const grants = grantsFor(ctx, permission);
  if (grants.length === 0) return false;
  if (grants.some((g) => g.scope.type === 'global')) return true;
  const rows = await queryRows<{ allowed: boolean }>(
    executor,
    sql`SELECT ${personScopeFilter(ctx, permission, sql`${personId}::uuid`)} AS allowed`,
  );
  return rows[0]?.allowed === true;
}

/**
 * Ministry-structure scope check (no database needed): global grants, a ministry grant for
 * the ministry, or a team grant for the team.
 */
export function hasStructureScope(
  ctx: RequestContext,
  permission: PermissionKey,
  target: { ministryId: string; teamId?: string | null },
): boolean {
  return grantsFor(ctx, permission).some(
    (g) =>
      g.scope.type === 'global' ||
      (g.scope.type === 'ministry' && g.scope.ministryId === target.ministryId) ||
      (g.scope.type === 'team' && target.teamId != null && g.scope.teamId === target.teamId),
  );
}

export function assertStructureScope(
  ctx: RequestContext,
  permission: PermissionKey,
  target: { ministryId: string; teamId?: string | null },
): void {
  if (ctx.actor.kind !== 'user') throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  if (!hasStructureScope(ctx, permission, target)) throw notFound('ministry');
}

// ─── Prayer chains ────────────────────────────────────────────────────────────

export interface ChainRef {
  id: string;
  ministryId: string | null;
}

/**
 * Chain-level access (no database): a global grant, a grant for the chain's ministry, or a grant
 * for the chain itself. Branch grants never reach a chain board — leaders see their own people's
 * participation instead (docs/06 note g).
 */
export function canAccessChain(ctx: RequestContext, permission: PermissionKey, chain: ChainRef): boolean {
  return grantsFor(ctx, permission).some(
    (g) =>
      g.scope.type === 'global' ||
      (g.scope.type === 'ministry' && chain.ministryId !== null && g.scope.ministryId === chain.ministryId) ||
      (g.scope.type === 'prayer_chain' && g.scope.chainId === chain.id),
  );
}

/** Throws NOT_FOUND so chains outside the actor's scope look like missing ones (docs/06 T14). */
export function assertChainAccess(ctx: RequestContext, permission: PermissionKey, chain: ChainRef): void {
  if (ctx.actor.kind !== 'user') throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  if (!canAccessChain(ctx, permission, chain)) throw notFound('prayer chain');
}

/** Whether the actor can reach any chain at all with this permission (navigation, dashboards). */
export function hasChainScope(ctx: RequestContext, permission: PermissionKey): boolean {
  return grantsFor(ctx, permission).some((g) => g.scope.type === 'global' || g.scope.type === 'ministry' || g.scope.type === 'prayer_chain');
}

/** SQL predicate restricting a chain list to the actor's chain scope. */
export function chainScopeFilter(
  ctx: RequestContext,
  permission: PermissionKey,
  chainId: SQL | AnyPgColumn,
  ministryId: SQL | AnyPgColumn,
): SQL {
  const grants = grantsFor(ctx, permission);
  if (grants.some((g) => g.scope.type === 'global')) return sql`TRUE`;
  const ministryIds = grants.flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : []));
  const chainIds = grants.flatMap((g) => (g.scope.type === 'prayer_chain' ? [g.scope.chainId] : []));
  const parts: SQL[] = [];
  if (ministryIds.length > 0) {
    parts.push(sql`${columnRef(ministryId)} IN (${sql.join(ministryIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  if (chainIds.length > 0) {
    parts.push(sql`${columnRef(chainId)} IN (${sql.join(chainIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`FALSE`;
}

/** Throws NOT_FOUND (never "forbidden") so out-of-scope people look like missing ones. */
export async function assertCanAccessPerson(
  executor: Executor,
  ctx: RequestContext,
  permission: PermissionKey,
  personId: string,
): Promise<void> {
  if (!(await canAccessPerson(executor, ctx, permission, personId))) throw notFound('person');
}
