import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { people, personUnavailability } from '../../db/schema';
import { forbidden, notFound } from '../../errors';
import { canAccessPerson, hasPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { addDays, zonedInstant } from '../journal/journal-dates';
import { ministryTimeZone, shortDateLabel } from './common';
import { UnavailabilityInput } from './devotional.schemas';
import { rosterPlaces } from './notify';

/**
 * Days someone can't serve (FR-DEV-08, MVP: entered by a coordinator). Roster filling and
 * substitute suggestions skip them, and rosters show a warning. The reason is optional and short.
 */

function assertCanManageAvailability(ctx: RequestContext) {
  if (!hasPermission(ctx, 'devotional.manage') && !hasPermission(ctx, 'devotional.teams.manage')) throw forbidden();
}

export async function addUnavailability(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UnavailabilityInput, raw);
  assertCanManageAvailability(ctx);
  return db.transaction(async (tx) => {
    const [person] = await tx.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, input.personId));
    if (!person || person.archivedAt || !(await canAccessPerson(tx, ctx, 'people.view', input.personId))) throw notFound('person');

    const timeZone = await ministryTimeZone(tx);
    const startsAt = zonedInstant(input.from, '00:00', timeZone);
    const endsAt = zonedInstant(addDays(input.to, 1), '00:00', timeZone);
    const [row] = await tx
      .insert(personUnavailability)
      .values({ personId: input.personId, startsAt, endsAt, reason: input.reason ?? null, source: 'coordinator', createdBy: actorUserId(ctx) })
      .returning({ id: personUnavailability.id });

    // Rosters they are already on during those days, so the coordinator can find substitutes.
    const affected = await rosterPlaces(
      tx,
      sql`ga.person_id = ${input.personId}::uuid AND ga.status IN ('pending', 'confirmed') AND g.status = 'scheduled'
          AND g.starts_at > ${ctx.now.toISOString()}::timestamptz
          AND tstzrange(g.starts_at, g.ends_at) && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz)`,
    );
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.unavailability_added',
      entityType: 'person',
      entityId: input.personId,
      newValues: { from: input.from, to: input.to },
    });
    return {
      unavailabilityId: row!.id,
      affected: affected.map((place) => ({
        gatheringId: place.gatheringId,
        label: `${place.gatheringName}, ${shortDateLabel(place.startsAt, timeZone)} (${place.roleName})`,
      })),
    };
  });
}

export async function removeUnavailability(db: Database, ctx: RequestContext, raw: unknown) {
  const { unavailabilityId } = parseInput(z.object({ unavailabilityId: z.uuid() }), raw);
  assertCanManageAvailability(ctx);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(personUnavailability).where(eq(personUnavailability.id, unavailabilityId));
    if (!row || !(await canAccessPerson(tx, ctx, 'people.view', row.personId))) throw notFound('away dates');
    await tx.delete(personUnavailability).where(eq(personUnavailability.id, row.id));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.unavailability_removed',
      entityType: 'person',
      entityId: row.personId,
      oldValues: { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() },
    });
  });
}
