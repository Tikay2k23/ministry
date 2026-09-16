import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, oneOf, pk, textPk, tstz, updatedAt } from '../columns';
import { SCOPE_TYPES, USER_STATUSES } from '../enums';
import { gatheringTypes } from './devotional';
import { ministries, teams } from './ministries';
import { people } from './people';
import { prayerChains } from './prayer';

/**
 * Portal accounts (docs/03 §4.5). Better Auth reads/writes the core columns
 * (id, name, email, emailVerified, image, twoFactorEnabled, createdAt, updatedAt);
 * personId/status/lastLoginAt are ours and declared as `additionalFields` in the auth config.
 */
export const users = pgTable(
  'users',
  {
    id: pk(),
    personId: uuid('person_id')
      .unique()
      .references((): AnyPgColumn => people.id),
    email: citext('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('invited'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('users_status_check', oneOf('status', USER_STATUSES))],
);

// ─── Better Auth managed tables ───────────────────────────────────────────────

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: textPk(),
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Set when the second factor was verified for this session (NULL = not verified). */
    twoFactorVerifiedAt: tstz('two_factor_verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_sessions_user').on(t.userId)],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: textPk(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('auth_accounts_user').on(t.userId),
    unique('auth_accounts_provider_account').on(t.providerId, t.accountId),
  ],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: textPk(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_verifications_identifier').on(t.identifier)],
);

/**
 * TOTP second factor, managed by our own two-factor service. Better Auth's plugin is not used
 * because its challenge does not cover magic-link sign-ins (docs/02 §3).
 */
export const userTwoFactors = pgTable(
  'user_two_factors',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
    /** AES-256-GCM encrypted base32 secret (src/server/crypto.ts). */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** NULL while setup is pending confirmation. */
    confirmedAt: tstz('confirmed_at'),
    /** SHA-256 hashes of unused backup codes. */
    backupCodeHashes: text('backup_code_hashes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    /** Last accepted TOTP time-step — prevents replaying a code. */
    lastUsedStep: bigint('last_used_step', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('user_two_factors_failed_attempts_check', sql`failed_attempts >= 0`)],
);

// ─── Authorisation (scoped RBAC, docs/06) ──────────────────────────────────────

/** Seeded from src/server/policy/catalog.ts — not user-editable. */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  isSensitive: boolean('is_sensitive').notNull().default(false),
  isPastoral: boolean('is_pastoral').notNull().default(false),
  allowedScopes: text('allowed_scopes').array().notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    defaultScopeType: text('default_scope_type', { enum: SCOPE_TYPES }).notNull(),
    defaultBranchDepth: smallint('default_branch_depth'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('roles_default_scope_type_check', oneOf('default_scope_type', SCOPE_TYPES)),
    check('roles_default_branch_depth_check', sql`default_branch_depth IS NULL OR default_branch_depth > 0`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references((): AnyPgColumn => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references((): AnyPgColumn => permissions.key, { onUpdate: 'cascade' }),
    /**
     * For branch-scoped grants: the deepest level this permission reaches, regardless of the
     * assignment's depth. E.g. a Primary Leader views the whole branch but edits only depth 1
     * (docs/06 §2 "V B · E D"). NULL = no cap.
     */
    branchDepthCap: smallint('branch_depth_cap'),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pk', columns: [t.roleId, t.permissionKey] }),
    check('role_permissions_depth_cap_check', sql`branch_depth_cap IS NULL OR branch_depth_cap > 0`),
  ],
);

/** One nullable FK column per scope type (docs/03 §4.5) so every scope reference is a real FK. */
export const userRoleAssignments = pgTable(
  'user_role_assignments',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references((): AnyPgColumn => roles.id),
    scopeType: text('scope_type', { enum: SCOPE_TYPES }).notNull(),
    /**
     * Branch anchor — usually the user's own person. References people (not hierarchy_nodes) so a
     * revoked assignment never blocks removing its anchor from the tree; placement is checked at grant time.
     */
    scopePersonId: uuid('scope_person_id').references((): AnyPgColumn => people.id),
    scopeMinistryId: uuid('scope_ministry_id').references((): AnyPgColumn => ministries.id),
    scopeTeamId: uuid('scope_team_id').references((): AnyPgColumn => teams.id),
    scopePrayerChainId: uuid('scope_prayer_chain_id').references((): AnyPgColumn => prayerChains.id),
    scopeGatheringTypeId: uuid('scope_gathering_type_id').references((): AnyPgColumn => gatheringTypes.id),
    /** NULL = unlimited; 1 = direct group only. */
    branchMaxDepth: smallint('branch_max_depth'),
    grantedBy: uuid('granted_by').references((): AnyPgColumn => users.id),
    grantedAt: tstz('granted_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at'),
    grantReason: text('grant_reason'),
    revokedAt: tstz('revoked_at'),
    revokedBy: uuid('revoked_by').references((): AnyPgColumn => users.id),
  },
  (t) => [
    check('role_assignment_scope_type_check', oneOf('scope_type', SCOPE_TYPES)),
    check(
      'role_assignment_scope_arity',
      sql`num_nonnulls(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id, scope_gathering_type_id) = CASE WHEN scope_type = 'global' THEN 0 ELSE 1 END`,
    ),
    check('role_assignment_branch_scope', sql`scope_type <> 'branch' OR scope_person_id IS NOT NULL`),
    check('role_assignment_ministry_scope', sql`scope_type <> 'ministry' OR scope_ministry_id IS NOT NULL`),
    check('role_assignment_team_scope', sql`scope_type <> 'team' OR scope_team_id IS NOT NULL`),
    check('role_assignment_prayer_chain_scope', sql`scope_type <> 'prayer_chain' OR scope_prayer_chain_id IS NOT NULL`),
    check('role_assignment_gathering_type_scope', sql`scope_type <> 'gathering_type' OR scope_gathering_type_id IS NOT NULL`),
    check(
      'role_assignment_branch_depth',
      sql`branch_max_depth IS NULL OR (branch_max_depth > 0 AND scope_type = 'branch')`,
    ),
    // One active assignment per (user, role, scope). The zero-UUID sentinel stands in for the
    // global scope (equivalent to NULLS NOT DISTINCT).
    uniqueIndex('role_assignment_active')
      .on(
        t.userId,
        t.roleId,
        t.scopeType,
        sql`coalesce(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id, scope_gathering_type_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`revoked_at IS NULL`),
    index('role_assignment_by_user').on(t.userId).where(sql`revoked_at IS NULL`),
  ],
);
