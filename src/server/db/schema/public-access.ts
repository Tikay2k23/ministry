import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz } from '../columns';
import { ACTION_TOKEN_PURPOSES, ENTRY_CODE_KINDS, ENTRY_CODE_STATUSES, PARTICIPANT_KEY_ORIGINS } from '../enums';
import { users } from './iam';
import { people } from './people';
import { prayerChains } from './prayer';

/**
 * Public access identifiers (docs/02 §5), deliberately kept apart:
 * - entry codes: printed and shared, grant context only (which leader or prayer chain), rotatable
 * - participant keys: "remember this phone" secrets (cookie only), stored as SHA-256 hashes
 * - action tokens: secret, personal, single-purpose, expiring links
 */

export const entryCodes = pgTable(
  'entry_codes',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    kind: text('kind', { enum: ENTRY_CODE_KINDS }).notNull(),
    leaderPersonId: uuid('leader_person_id').references((): AnyPgColumn => people.id),
    prayerChainId: uuid('prayer_chain_id').references((): AnyPgColumn => prayerChains.id),
    label: text('label'),
    status: text('status', { enum: ENTRY_CODE_STATUSES }).notNull().default('active'),
    retiredAt: tstz('retired_at'),
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => entryCodes.id),
    scanCount: integer('scan_count').notNull().default(0),
    lastScannedAt: tstz('last_scanned_at'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('entry_codes_code_format', sql`code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'`),
    check('entry_codes_kind_check', oneOf('kind', ENTRY_CODE_KINDS)),
    check('entry_codes_status_check', oneOf('status', ENTRY_CODE_STATUSES)),
    check('entry_codes_leader_consistency', sql`(kind = 'journal_leader') = (leader_person_id IS NOT NULL)`),
    check('entry_codes_chain_consistency', sql`(kind = 'prayer_chain') = (prayer_chain_id IS NOT NULL)`),
    check('entry_codes_retired_consistency', sql`(status = 'retired') = (retired_at IS NOT NULL)`),
    uniqueIndex('entry_code_active_leader')
      .on(t.leaderPersonId)
      .where(sql`status = 'active' AND kind = 'journal_leader'`),
    uniqueIndex('entry_code_active_general').on(t.kind).where(sql`status = 'active' AND kind = 'journal_general'`),
    uniqueIndex('entry_code_active_chain').on(t.prayerChainId).where(sql`status = 'active' AND kind = 'prayer_chain'`),
  ],
);

export const participantKeys = pgTable(
  'participant_keys',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    /** Hex SHA-256 of a 256-bit random secret that only ever lives in the participant's cookie. */
    keyHash: text('key_hash').notNull().unique(),
    /** Coarse, e.g. "Android · Chrome". */
    deviceHint: text('device_hint'),
    createdVia: text('created_via', { enum: PARTICIPANT_KEY_ORIGINS }).notNull(),
    /** false = "This isn't my phone": a short session key instead of a remembered device. */
    persistent: boolean('persistent').notNull().default(true),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    check('participant_keys_created_via_check', oneOf('created_via', PARTICIPANT_KEY_ORIGINS)),
    index('participant_keys_person').on(t.personId).where(sql`revoked_at IS NULL`),
  ],
);

export const actionTokens = pgTable(
  'action_tokens',
  {
    id: pk(),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ACTION_TOKEN_PURPOSES }).notNull(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id),
    /** The record the token acts on (e.g. a prayer assignment). Deliberately polymorphic, like care sources. */
    subjectId: uuid('subject_id'),
    expiresAt: tstz('expires_at').notNull(),
    maxUses: smallint('max_uses').notNull().default(1),
    useCount: smallint('use_count').notNull().default(0),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('action_tokens_purpose_check', oneOf('purpose', ACTION_TOKEN_PURPOSES)),
    check('action_tokens_use_count', sql`use_count <= max_uses`),
    check('action_tokens_subject', sql`purpose = 'personal_key_install' OR subject_id IS NOT NULL`),
    index('action_tokens_person').on(t.personId),
    index('action_tokens_subject').on(t.subjectId).where(sql`subject_id IS NOT NULL`),
    index('action_tokens_expiry').on(t.expiresAt),
  ],
);

/** Fixed-window rate-limit counters. Made UNLOGGED in migration 0004 (loss on crash is acceptable). */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    /** HMAC of the subject (never a raw phone number or IP). */
    bucketKey: text('bucket_key').notNull(),
    windowStart: tstz('window_start').notNull(),
    hits: integer('hits').notNull().default(1),
  },
  (t) => [primaryKey({ name: 'rate_limit_buckets_pk', columns: [t.bucketKey, t.windowStart] })],
);
