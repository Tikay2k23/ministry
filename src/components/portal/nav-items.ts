import type { PermissionKey } from '@/server/policy/catalog';

/**
 * Portal navigation (docs/04 §3). Items appear only when the user holds the permission,
 * and modules appear as they are delivered.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: 'dashboard' | 'journal' | 'followups' | 'people' | 'leadership' | 'reports' | 'ministries' | 'users' | 'account';
  section: 'main' | 'organisation' | 'admin' | 'personal';
  permission?: PermissionKey;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: 'dashboard', section: 'main' },
  { href: '/app/journal', label: 'Daily Journal', icon: 'journal', section: 'main', permission: 'journal.status.view' },
  { href: '/app/follow-ups', label: 'Follow-ups', icon: 'followups', section: 'main', permission: 'care.view' },
  { href: '/app/people', label: 'People', icon: 'people', section: 'main', permission: 'people.view' },
  { href: '/app/leadership', label: 'Leadership', icon: 'leadership', section: 'main', permission: 'hierarchy.view' },
  { href: '/app/reports', label: 'Reports', icon: 'reports', section: 'main', permission: 'reports.view' },
  { href: '/app/ministries', label: 'Ministries', icon: 'ministries', section: 'organisation', permission: 'ministries.view' },
  { href: '/app/admin/users', label: 'Users & Permissions', icon: 'users', section: 'admin', permission: 'iam.users.view' },
  { href: '/app/account/security', label: 'My account', icon: 'account', section: 'personal' },
];
