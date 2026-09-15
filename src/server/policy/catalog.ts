/**
 * Permission catalog and system role bundles — the single source of truth for
 * docs/06-permission-matrix.md. Seeds the `permissions`, `roles` and `role_permissions`
 * tables and drives the permission test suite.
 *
 * Scope types available now: global, branch, ministry, team and prayer_chain (M3).
 * The Worship Coordinator role arrives with the Devotional module (M4), together with the
 * gathering_type scope type.
 */
import type { ScopeType } from '../db/enums';

interface PermissionDefinition {
  module: string;
  description: string;
  /** Requires a 2FA-verified session; reads are access-logged. */
  sensitive?: boolean;
  /** Pastoral content: assignment notifies Pastors. Never granted to Super Admin by default. */
  pastoral?: boolean;
  scopes: readonly ScopeType[];
}

const G = ['global'] as const;
const GB = ['global', 'branch'] as const;
const GBMT = ['global', 'branch', 'ministry', 'team'] as const;
const GM = ['global', 'ministry'] as const;
const GMT = ['global', 'ministry', 'team'] as const;
/** Chain-scoped grants: coordinators act on their chains and see those chains' participants. */
const GBMTC = ['global', 'branch', 'ministry', 'team', 'prayer_chain'] as const;
const GMC = ['global', 'ministry', 'prayer_chain'] as const;

export const PERMISSIONS = {
  // People
  'people.view': { module: 'people', description: 'View people profiles (basic fields)', scopes: GBMTC },
  'people.contact.view': { module: 'people', description: 'View phone, email, address and birthday', scopes: GBMTC },
  'people.create': { module: 'people', description: 'Add people', scopes: GB },
  'people.edit': { module: 'people', description: 'Edit profile fields', scopes: GB },
  'people.contact.edit': { module: 'people', description: 'Edit contact details', scopes: GB },
  'people.archive': { module: 'people', description: 'Archive people', scopes: G },
  'people.merge': { module: 'people', description: 'Review and merge duplicates', sensitive: true, scopes: G },
  'people.export': { module: 'people', description: 'Export people (CSV)', sensitive: true, scopes: GBMT },
  'people.registrations.confirm': { module: 'people', description: 'Confirm new registrations', scopes: GB },
  'people.links.issue': { module: 'people', description: 'Issue personal links, revoke device keys', scopes: GB },
  'import.manage': { module: 'people', description: 'Import people from CSV', sensitive: true, scopes: G },

  // Leadership hierarchy
  'hierarchy.view': { module: 'hierarchy', description: 'View the leadership tree', scopes: GB },
  'hierarchy.manage': { module: 'hierarchy', description: 'Place, move and reassign people', scopes: GB },
  'hierarchy.requests.decide': { module: 'hierarchy', description: 'Approve or reject leader change requests', scopes: GB },

  // Ministries
  'ministries.view': { module: 'ministries', description: 'View ministries, departments and teams', scopes: GMT },
  'ministries.manage': { module: 'ministries', description: 'Create and archive ministries', scopes: G },
  'ministry.structure.manage': { module: 'ministries', description: 'Manage departments and teams', scopes: GM },
  'ministry.members.manage': { module: 'ministries', description: 'Manage ministry and team members', scopes: GMT },

  // Daily journal (enforced from M2)
  'journal.status.view': { module: 'journal', description: 'See who submitted, late, missed', scopes: GB },
  'journal.content.view': { module: 'journal', description: 'Read standard journal answers', sensitive: true, pastoral: true, scopes: GB },
  'journal.content.restricted.view': { module: 'journal', description: 'Read restricted journal answers', sensitive: true, pastoral: true, scopes: GB },
  'journal.content.confidential.view': { module: 'journal', description: 'Read confidential journal answers', sensitive: true, pastoral: true, scopes: G },
  'journal.review': { module: 'journal', description: 'Review journal entries', scopes: GB },
  'journal.proxy_submit': { module: 'journal', description: 'Submit a journal on behalf of a person', scopes: GB },
  'journal.excuse': { module: 'journal', description: 'Excuse days and add personal pauses', scopes: GB },
  'journal.settings.manage': { module: 'journal', description: 'Manage journal policy and rest days', scopes: G },
  'forms.manage': { module: 'journal', description: 'Edit journal questions (draft)', scopes: G },
  'forms.publish': { module: 'journal', description: 'Publish journal questions', scopes: G },

  // Care & notes
  'care.view': { module: 'care', description: 'View follow-ups', scopes: GBMTC },
  'care.manage': { module: 'care', description: 'Create and resolve follow-ups', scopes: GBMTC },
  'care.pastoral.view': { module: 'care', description: 'View pastoral follow-ups', sensitive: true, pastoral: true, scopes: G },
  'notes.leadership.view': { module: 'care', description: 'View leadership notes', scopes: GB },
  'notes.leadership.create': { module: 'care', description: 'Write leadership notes', scopes: GB },
  'notes.pastoral.view': { module: 'care', description: 'View pastoral notes', sensitive: true, pastoral: true, scopes: G },
  'notes.pastoral.create': { module: 'care', description: 'Write pastoral notes', sensitive: true, pastoral: true, scopes: G },

  // Prayer chain (enforced from M3)
  'prayer.view': { module: 'prayer', description: 'View prayer chains and participation', scopes: GBMTC },
  'prayer.manage': { module: 'prayer', description: 'Manage prayer chains and schedules', scopes: GMC },
  'prayer.assign': { module: 'prayer', description: 'Assign prayer slots and substitutes', scopes: GMC },
  'prayer.resolve': { module: 'prayer', description: 'Resolve follow-ups (missed / excused / verified)', scopes: GMC },
  'prayer.reports.view': { module: 'prayer', description: 'Read prayer reports and testimonies', sensitive: true, scopes: GMC },
  'prayer.requests.confidential.view': { module: 'prayer', description: 'Read confidential prayer requests', sensitive: true, pastoral: true, scopes: G },

  // Devotional (enforced from M4)
  'devotional.view': { module: 'devotional', description: 'View devotional schedules and rosters', scopes: GMT },
  'devotional.manage': { module: 'devotional', description: 'Manage schedules and rosters', scopes: GMT },
  'devotional.teams.manage': { module: 'devotional', description: 'Manage worship teams and serving roles', scopes: GMT },

  // Reports
  'reports.view': { module: 'reports', description: 'Run reports within scope', scopes: GBMTC },
  'reports.export': { module: 'reports', description: 'Export reports (CSV)', sensitive: true, scopes: GBMTC },

  // Public links / QR
  'links.manage': { module: 'links', description: 'Manage all QR entry codes', scopes: G },
  'links.own.manage': { module: 'links', description: 'Download and rotate own leader QR code', scopes: GB },

  // Notifications
  'notifications.manage': { module: 'notifications', description: 'Manage notification templates and channels', scopes: G },

  // Identity & access
  'iam.users.view': { module: 'iam', description: 'View portal users and their roles', scopes: G },
  'iam.users.manage': { module: 'iam', description: 'Invite users and assign roles', sensitive: true, scopes: G },
  'iam.roles.manage': { module: 'iam', description: 'Edit role permission bundles', sensitive: true, scopes: G },
  'access.break_glass': { module: 'iam', description: 'Temporary audited emergency access to pastoral content', sensitive: true, scopes: G },

  // Settings & audit
  'settings.view': { module: 'settings', description: 'View system settings', scopes: G },
  'settings.manage': { module: 'settings', description: 'Change system settings', sensitive: true, scopes: G },
  'audit.view': { module: 'audit', description: 'View the audit and access log', sensitive: true, scopes: G },
  'audit.view.entity': { module: 'audit', description: 'View history of records you can see', scopes: GBMT },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export function permissionDefinition(key: PermissionKey): PermissionDefinition {
  return PERMISSIONS[key];
}

export function isSensitive(key: PermissionKey): boolean {
  return (PERMISSIONS[key] as PermissionDefinition).sensitive === true;
}

export function isPastoral(key: PermissionKey): boolean {
  return (PERMISSIONS[key] as PermissionDefinition).pastoral === true;
}

/** A permission in a role bundle, optionally capped to a branch depth. */
export type BundleEntry = PermissionKey | { key: PermissionKey; depthCap: number };

export interface RoleDefinition {
  name: string;
  description: string;
  defaultScopeType: ScopeType;
  /** For branch roles: default assignment depth (NULL = whole downline). */
  defaultBranchDepth?: number;
  permissions: readonly BundleEntry[];
}

const direct = (key: PermissionKey): BundleEntry => ({ key, depthCap: 1 });

export const ROLES = {
  super_admin: {
    name: 'Super Admin',
    description: 'System configuration. No pastoral content by default (break-glass only).',
    defaultScopeType: 'global',
    permissions: [
      'people.view', 'people.contact.view', 'people.create', 'people.edit', 'people.contact.edit',
      'people.archive', 'people.merge', 'people.export', 'people.registrations.confirm', 'people.links.issue',
      'import.manage', 'hierarchy.view', 'hierarchy.manage', 'hierarchy.requests.decide',
      'ministries.view', 'ministries.manage', 'ministry.structure.manage', 'ministry.members.manage',
      'journal.status.view', 'journal.excuse', 'journal.settings.manage', 'forms.manage',
      'prayer.view', 'prayer.manage', 'prayer.assign', 'prayer.resolve',
      'devotional.view', 'devotional.manage', 'devotional.teams.manage',
      'reports.view', 'reports.export', 'links.manage', 'notifications.manage',
      'iam.users.view', 'iam.users.manage', 'iam.roles.manage', 'access.break_glass',
      'settings.view', 'settings.manage', 'audit.view', 'audit.view.entity',
    ],
  },
  pastor: {
    name: 'Pastor / Executive',
    description: 'Ministry-wide oversight, including pastoral content.',
    defaultScopeType: 'global',
    permissions: [
      'people.view', 'people.contact.view', 'people.edit', 'people.export', 'people.registrations.confirm',
      'hierarchy.view', 'hierarchy.manage', 'hierarchy.requests.decide', 'ministries.view',
      'journal.status.view', 'journal.content.view', 'journal.content.restricted.view',
      'journal.content.confidential.view', 'journal.review', 'journal.excuse', 'journal.settings.manage',
      'forms.publish', 'care.view', 'care.manage', 'care.pastoral.view',
      'notes.leadership.view', 'notes.leadership.create', 'notes.pastoral.view', 'notes.pastoral.create',
      'prayer.view', 'prayer.reports.view', 'prayer.requests.confidential.view', 'devotional.view',
      'reports.view', 'reports.export', 'iam.users.view', 'iam.users.manage',
      'settings.view', 'audit.view', 'audit.view.entity',
    ],
  },
  pastoral_care: {
    name: 'Pastoral Care',
    description: 'Confidential journal answers, pastoral notes and sensitive follow-ups.',
    defaultScopeType: 'global',
    permissions: [
      'people.view', 'people.contact.view', 'hierarchy.view', 'ministries.view',
      'journal.status.view', 'journal.content.view', 'journal.content.restricted.view',
      'journal.content.confidential.view', 'journal.review', 'journal.excuse',
      'care.view', 'care.manage', 'care.pastoral.view',
      'notes.leadership.view', 'notes.leadership.create', 'notes.pastoral.view', 'notes.pastoral.create',
      'prayer.view', 'prayer.reports.view', 'prayer.requests.confidential.view', 'devotional.view',
      'reports.view', 'audit.view.entity',
    ],
  },
  ministry_admin: {
    name: 'Ministry Administrator',
    description: 'Office staff: directory, imports, structure. No journal content.',
    defaultScopeType: 'global',
    permissions: [
      'people.view', 'people.contact.view', 'people.create', 'people.edit', 'people.contact.edit',
      'people.archive', 'people.merge', 'people.export', 'people.registrations.confirm', 'people.links.issue',
      'import.manage', 'hierarchy.view', 'hierarchy.manage', 'hierarchy.requests.decide',
      'ministries.view', 'ministries.manage', 'ministry.structure.manage', 'ministry.members.manage',
      'journal.status.view', 'journal.excuse', 'journal.settings.manage', 'forms.manage',
      'care.view', 'prayer.view', 'devotional.view', 'reports.view', 'reports.export',
      'links.manage', 'notifications.manage', 'iam.users.view', 'audit.view.entity',
    ],
  },
  primary_leader: {
    name: 'Primary Leader',
    description: 'Oversees their whole leadership branch; reads journals of their own group.',
    defaultScopeType: 'branch',
    permissions: [
      'people.view', 'people.contact.view', 'people.create', direct('people.edit'), direct('people.contact.edit'),
      'people.export', 'people.registrations.confirm', 'people.links.issue',
      'hierarchy.view', 'hierarchy.manage', 'hierarchy.requests.decide', 'ministries.view',
      'journal.status.view', 'journal.content.view', direct('journal.content.restricted.view'),
      direct('journal.review'), direct('journal.proxy_submit'), 'journal.excuse',
      'care.view', 'care.manage', 'notes.leadership.view', 'notes.leadership.create',
      'prayer.view', 'devotional.view', 'reports.view', 'reports.export',
      'links.own.manage', 'audit.view.entity',
    ],
  },
  leader: {
    name: 'Leader',
    description: 'Shepherds their direct group.',
    defaultScopeType: 'branch',
    defaultBranchDepth: 1,
    permissions: [
      'people.view', 'people.contact.view', 'people.create', 'people.edit', 'people.contact.edit',
      'people.export', 'people.registrations.confirm', 'people.links.issue',
      'hierarchy.view', 'ministries.view',
      'journal.status.view', 'journal.content.view', direct('journal.content.restricted.view'),
      direct('journal.review'), direct('journal.proxy_submit'), 'journal.excuse',
      'care.view', 'care.manage', 'notes.leadership.view', 'notes.leadership.create',
      'prayer.view', 'devotional.view', 'reports.view', 'reports.export',
      'links.own.manage', 'audit.view.entity',
    ],
  },
  ministry_head: {
    name: 'Ministry Head',
    description: 'Manages their ministry, departments, teams and members.',
    defaultScopeType: 'ministry',
    permissions: [
      'people.view', 'people.contact.view', 'people.export', 'ministries.view',
      'ministry.structure.manage', 'ministry.members.manage', 'devotional.view',
      'reports.view', 'reports.export',
    ],
  },
  prayer_coordinator: {
    name: 'Prayer Chain Coordinator',
    description: 'Runs their prayer chains: schedules, assignments and gentle follow-up.',
    defaultScopeType: 'prayer_chain',
    permissions: [
      'people.view', 'people.contact.view', 'prayer.view', 'prayer.manage', 'prayer.assign', 'prayer.resolve',
      'prayer.reports.view', 'care.view', 'care.manage', 'reports.view', 'reports.export',
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only dashboards and reports.',
    defaultScopeType: 'global',
    permissions: [
      'people.view', 'hierarchy.view', 'ministries.view', 'journal.status.view',
      'prayer.view', 'devotional.view', 'reports.view',
    ],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;

export function bundleEntryKey(entry: BundleEntry): PermissionKey {
  return typeof entry === 'string' ? entry : entry.key;
}

export function bundleEntryDepthCap(entry: BundleEntry): number | null {
  return typeof entry === 'string' ? null : entry.depthCap;
}
