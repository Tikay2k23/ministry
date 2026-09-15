import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { normalizePhone } from '@/lib/phone';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor, Transaction } from '../../db/client';
import {
  authSessions,
  designationTypes,
  leaderChangeRequests,
  people,
  personDesignations,
  personDuplicateCandidates,
  userRoleAssignments,
  users,
} from '../../db/schema';
import { conflict, forbidden, invalidState, notFound, validationError } from '../../errors';
import { assertCanAccessPerson, assertGlobal, assertPermission, canAccessPerson, hasGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { changedFields, recordAudit } from '../audit/audit.service';
import { childIds, deleteLeafNode, getNode, lockHierarchy, writeHistory } from '../hierarchy/hierarchy.core';
import { placeNewPersonInTx } from '../hierarchy/hierarchy.service';
import { markJournalLedgerDirty } from '../journal/ledger-dirty';
import { getSetting } from '../settings/settings.service';
import { findDuplicateMatches, recordDuplicateCandidates, type DuplicateMatch } from './dedupe';
import { generatePersonCodes } from './person-codes';
import { ArchivePersonInput, CreatePersonInput, UpdatePersonInput } from './people.schemas';
import { newId } from '@/lib/ids';
import { z } from 'zod';

/** Contact details need `people.contact.*` in addition to `people.view` / `people.edit`. */
const CONTACT_FIELDS = ['phoneE164', 'email', 'addressLine', 'city', 'province', 'birthMonth', 'birthDay', 'birthYear'] as const;

async function normalizePhoneInput(executor: Executor, raw: string | null | undefined): Promise<string | null | undefined> {
  if (raw === undefined || raw === null) return raw;
  const { defaultCountry } = await getSetting(executor, 'ministry.profile');
  const result = normalizePhone(raw, defaultCountry);
  if (!result.ok) throw validationError({ phone: ['Enter a valid mobile number, for example 0917 123 4567.'] });
  return result.e164;
}

/** Audit values with contact details redacted (the audit log is not a second directory). */
function redactContact(values: Record<string, unknown> | null | undefined) {
  if (!values) return values;
  const out: Record<string, unknown> = { ...values };
  for (const key of CONTACT_FIELDS) if (key in out) out[key] = out[key] == null ? null : '[changed]';
  return out;
}

async function syncDesignations(tx: Transaction, personId: string, keys: string[] | undefined, today: string) {
  if (keys === undefined) return false;
  const valid = new Set(
    (await tx.select({ key: designationTypes.key }).from(designationTypes)).map((d) => d.key),
  );
  const wanted = new Set(keys.filter((k) => valid.has(k)));
  const current = await tx
    .select({ id: personDesignations.id, key: personDesignations.designationKey })
    .from(personDesignations)
    .where(and(eq(personDesignations.personId, personId), isNull(personDesignations.endedOn)));
  const currentKeys = new Set(current.map((c) => c.key));
  const toEnd = current.filter((c) => !wanted.has(c.key)).map((c) => c.id);
  const toAdd = [...wanted].filter((k) => !currentKeys.has(k));
  if (toEnd.length) {
    await tx.update(personDesignations).set({ endedOn: today }).where(inArray(personDesignations.id, toEnd));
  }
  if (toAdd.length) {
    await tx.insert(personDesignations).values(toAdd.map((designationKey) => ({ personId, designationKey, startedOn: today })));
  }
  return toEnd.length > 0 || toAdd.length > 0;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Blocking duplicates are shown only when the actor can already see that person. */
async function throwIfDuplicate(tx: Transaction, ctx: RequestContext, matches: DuplicateMatch[]) {
  const blocking = matches.filter((m) => m.strength !== 'weak');
  if (blocking.length === 0) return;
  const visible = [];
  for (const m of blocking) {
    if (await canAccessPerson(tx, ctx, 'people.view', m.personId)) {
      visible.push({ personId: m.personId, personCode: m.personCode, name: `${m.firstName} ${m.lastName}`, reasons: m.reasons });
    }
  }
  throw conflict('This person may already be in the directory.', {
    reason: 'DUPLICATE_SUSPECTED',
    candidates: visible,
    hiddenCount: blocking.length - visible.length,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createPerson(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreatePersonInput, raw);
  assertPermission(ctx, 'people.create');
  const phoneE164 = (await normalizePhoneInput(db, input.phone)) ?? null;

  return db.transaction(async (tx) => {
    if (input.leaderId) {
      await assertCanAccessPerson(tx, ctx, 'people.create', input.leaderId);
      if (!(await getNode(tx, input.leaderId))) {
        throw validationError({ leaderId: ['This leader is not in the leadership structure yet.'] });
      }
    } else if (!hasGlobal(ctx, 'people.create')) {
      // Branch-scoped creators (leaders) add people into their own group.
      throw validationError({ leaderId: ['Choose the leader this person belongs to.'] });
    }

    const matches = await findDuplicateMatches(tx, { ...input, phoneE164, email: input.email ?? null });
    if (!input.confirmNotDuplicate) await throwIfDuplicate(tx, ctx, matches);

    const [personCode] = await generatePersonCodes(tx, 1);
    const [person] = await tx
      .insert(people)
      .values({
        personCode: personCode!,
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName ?? null,
        suffix: input.suffix ?? null,
        preferredName: input.preferredName ?? null,
        gender: input.gender ?? null,
        birthMonth: input.birthMonth ?? null,
        birthDay: input.birthDay ?? null,
        birthYear: input.birthYear ?? null,
        phoneE164,
        email: input.email ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        joinedOn: input.joinedOn ?? null,
        journalExpected: input.journalExpected ?? true,
        source: 'portal',
        createdBy: actorUserId(ctx),
        updatedBy: actorUserId(ctx),
      })
      .returning({ id: people.id, personCode: people.personCode });

    await syncDesignations(tx, person!.id, input.designations, isoDate(ctx.now));
    if (input.leaderId) {
      await placeNewPersonInTx(tx, ctx, { personId: person!.id, leaderId: input.leaderId, acceptsMembers: input.acceptsMembers });
    }
    await recordDuplicateCandidates(tx, person!.id, matches);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'person.created',
      entityType: 'person',
      entityId: person!.id,
      newValues: redactContact({
        firstName: input.firstName,
        lastName: input.lastName,
        leaderId: input.leaderId ?? null,
        phoneE164,
        email: input.email ?? null,
        duplicateOverride: input.confirmNotDuplicate === true && matches.some((m) => m.strength !== 'weak'),
      }),
    });
    return { personId: person!.id, personCode: person!.personCode };
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updatePerson(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdatePersonInput, raw);
  assertPermission(ctx, 'people.edit');
  const phoneE164 = await normalizePhoneInput(db, input.phone);

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(people).where(eq(people.id, input.personId)).for('update');
    if (!before) throw notFound('person');
    await assertCanAccessPerson(tx, ctx, 'people.edit', before.id);
    if (before.archivedAt) throw invalidState('Archived people can’t be edited.');
    if (before.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw conflict('Someone else updated this profile while you were editing. Please reload and try again.');
    }

    const patch = {
      firstName: input.firstName,
      lastName: input.lastName,
      middleName: input.middleName,
      suffix: input.suffix,
      preferredName: input.preferredName,
      gender: input.gender,
      birthMonth: input.birthMonth,
      birthDay: input.birthDay,
      birthYear: input.birthYear,
      phoneE164,
      email: input.email,
      addressLine: input.addressLine,
      city: input.city,
      province: input.province,
      joinedOn: input.joinedOn,
      journalExpected: input.journalExpected,
      status: input.status,
    };
    const diff = changedFields(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);

    if (diff && CONTACT_FIELDS.some((k) => k in diff.newValues)) {
      if (!(await canAccessPerson(tx, ctx, 'people.contact.edit', before.id))) {
        throw forbidden('You can view this person but not change their contact details.');
      }
    }
    if (diff?.newValues.status === 'inactive' && (await childIds(tx, before.id)).length > 0) {
      throw invalidState('This person still leads a group. Reassign their group before marking them inactive.', {
        reason: 'HAS_DIRECT_GROUP',
      });
    }

    const designationsChanged = await syncDesignations(tx, before.id, input.designations, isoDate(ctx.now));
    if (!diff && !designationsChanged) return { personId: before.id, updatedAt: before.updatedAt };

    const [after] = await tx
      .update(people)
      .set({ ...(diff?.newValues ?? {}), updatedAt: ctx.now, updatedBy: actorUserId(ctx) })
      .where(eq(people.id, before.id))
      .returning();
    if (diff && ('status' in diff.newValues || 'journalExpected' in diff.newValues)) {
      await markJournalLedgerDirty(tx); // who is expected to journal has changed
    }

    const identityChanged = diff && ['firstName', 'lastName', 'phoneE164', 'email'].some((k) => k in diff.newValues);
    if (identityChanged) {
      const matches = await findDuplicateMatches(tx, { ...after!, excludePersonId: after!.id });
      await recordDuplicateCandidates(tx, after!.id, matches.filter((m) => m.strength !== 'weak'));
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'person.updated',
      entityType: 'person',
      entityId: before.id,
      oldValues: redactContact(diff?.oldValues),
      newValues: redactContact({ ...(diff?.newValues ?? {}), ...(designationsChanged ? { designations: input.designations } : {}) }),
    });
    return { personId: before.id, updatedAt: after!.updatedAt };
  });
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archivePerson(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ArchivePersonInput, raw);
  assertGlobal(ctx, 'people.archive');

  return db.transaction(async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, input.personId)).for('update');
    if (!person) throw notFound('person');
    if (person.archivedAt) throw invalidState('This person is already archived.');

    const node = await getNode(tx, person.id);
    if (node) {
      await lockHierarchy(tx);
      if ((await childIds(tx, person.id)).length > 0) {
        throw invalidState('This person still leads a group. Reassign their group before archiving.', {
          reason: 'HAS_DIRECT_GROUP',
        });
      }
      await deleteLeafNode(tx, person.id);
      await writeHistory(
        tx,
        [{ personId: person.id, previousLeaderPersonId: node.parentPersonId, newLeaderPersonId: null, changeType: 'removed' }],
        { operationId: newId(), changedBy: actorUserId(ctx), reason: `Archived: ${input.reason}`, at: ctx.now },
      );
    }

    // Portal access ends with the archive (E16).
    const [account] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.personId, person.id));
    if (account && account.status !== 'deactivated') {
      await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now }).where(eq(users.id, account.id));
      await tx.delete(authSessions).where(eq(authSessions.userId, account.id));
      await recordAudit(tx, ctx, {
        category: 'security',
        action: 'iam.user_deactivated',
        entityType: 'user',
        entityId: account.id,
        reason: `Person archived (${input.reason})`,
      });
    }
    await tx
      .update(userRoleAssignments)
      .set({ revokedAt: ctx.now, revokedBy: actorUserId(ctx) })
      .where(
        and(
          isNull(userRoleAssignments.revokedAt),
          account
            ? sql`(${userRoleAssignments.userId} = ${account.id} OR ${userRoleAssignments.scopePersonId} = ${person.id})`
            : eq(userRoleAssignments.scopePersonId, person.id),
        ),
      );
    await tx
      .update(leaderChangeRequests)
      .set({ status: 'cancelled', decidedAt: ctx.now, decidedBy: actorUserId(ctx), decisionNote: 'Person archived' })
      .where(and(eq(leaderChangeRequests.personId, person.id), eq(leaderChangeRequests.status, 'pending')));

    await tx
      .update(people)
      .set({ archivedAt: ctx.now, archivedReason: input.reason, updatedAt: ctx.now, updatedBy: actorUserId(ctx) })
      .where(eq(people.id, person.id));
    await markJournalLedgerDirty(tx);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'person.archived',
      entityType: 'person',
      entityId: person.id,
      newValues: { archivedReason: input.reason },
      reason: input.note ?? null,
    });
  });
}

// ─── Duplicate review ─────────────────────────────────────────────────────────

export const ResolveDuplicateInput = z.object({ candidateId: z.uuid(), decision: z.literal('not_duplicate') });

/** Merging arrives in V1 (docs/05 W16); for now reviewers can dismiss false positives. */
export async function resolveDuplicateCandidate(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ResolveDuplicateInput, raw);
  assertGlobal(ctx, 'people.merge');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(personDuplicateCandidates)
      .set({ status: 'not_duplicate', reviewedBy: actorUserId(ctx), reviewedAt: ctx.now })
      .where(and(eq(personDuplicateCandidates.id, input.candidateId), eq(personDuplicateCandidates.status, 'open')))
      .returning({ a: personDuplicateCandidates.personAId, b: personDuplicateCandidates.personBId });
    if (!row) throw notFound('duplicate candidate');
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'person.duplicate_dismissed',
      entityType: 'person_duplicate_candidate',
      entityId: input.candidateId,
      newValues: { personAId: row.a, personBId: row.b },
    });
  });
}
