'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, inputClassName } from '@/components/ui/field';
import { grantAccessAction, revokeRoleAction } from './actions';

interface Role {
  key: string;
  name: string;
  description: string;
  scopeType: string;
  available: boolean;
  unavailableReason: string | null;
}

interface Account {
  userId: string;
  status: string;
  roles: { assignmentId: string; roleKey: string; roleName: string; scopeType: string; branchMaxDepth: number | null }[];
}

const STATUS_LABEL: Record<string, string> = {
  invited: 'Invited — hasn’t signed in yet',
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
};

const scopeLabel = (scopeType: string, depth: number | null) =>
  scopeType === 'branch' ? (depth === 1 ? 'own group' : 'whole branch') : scopeType === 'ministry' ? 'ministry' : null;

export function PortalAccessCard({
  personId,
  personEmail,
  account,
  canManage,
  roles,
  ministries,
}: {
  personId: string;
  personEmail: string | null;
  account: Account | null;
  canManage: boolean;
  roles: Role[];
  ministries: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [roleKey, setRoleKey] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, startTransition] = useTransition();
  const selected = roles.find((r) => r.key === roleKey);
  const heldRoles = new Set(account?.roles.map((r) => r.roleKey) ?? []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      const result = await grantAccessAction(formData);
      if (result.ok) {
        setMessage({ tone: 'success', text: result.data.invited ? 'Invitation sent by email.' : 'Role added.' });
        setRoleKey('');
        router.refresh();
      } else {
        setFieldErrors(result.error.fieldErrors);
        setMessage({ tone: 'error', text: result.error.message });
      }
    });
  }

  function revoke(assignmentId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeRoleAction(assignmentId, personId);
      if (result.ok) router.refresh();
      else setMessage({ tone: 'error', text: result.error.message });
    });
  }

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {account ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted">{STATUS_LABEL[account.status] ?? account.status}</p>
          {account.roles.length === 0 && <p className="text-muted">No roles.</p>}
          <ul className="space-y-1.5">
            {account.roles.map((r) => (
              <li key={r.assignmentId} className="flex items-center justify-between gap-2">
                <Badge tone="green">
                  {r.roleName}
                  {scopeLabel(r.scopeType, r.branchMaxDepth) && ` · ${scopeLabel(r.scopeType, r.branchMaxDepth)}`}
                </Badge>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(r.assignmentId)} disabled={pending}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">No portal account. Most people never need one.</p>
      )}

      {canManage && account?.status !== 'deactivated' && (
        <form onSubmit={submit} className="space-y-3 border-t border-line pt-4">
          <input type="hidden" name="personId" value={personId} />
          <div className="space-y-1.5">
            <label htmlFor="roleKey" className="block text-sm font-medium">
              {account ? 'Add a role' : 'Invite with role'}
            </label>
            <select
              id="roleKey"
              name="roleKey"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
              className={inputClassName}
              required
            >
              <option value="">Choose a role…</option>
              {roles
                .filter((r) => !heldRoles.has(r.key) || r.scopeType === 'ministry')
                .map((r) => (
                  <option key={r.key} value={r.key} disabled={!r.available}>
                    {r.name}
                    {!r.available && r.unavailableReason ? ` (${r.unavailableReason})` : ''}
                  </option>
                ))}
            </select>
            {selected && <p className="text-xs text-muted">{selected.description}</p>}
            {fieldErrors?.roleKey && <p className="text-sm text-error">{fieldErrors.roleKey.join(' ')}</p>}
          </div>
          {selected?.scopeType === 'ministry' && (
            <div className="space-y-1.5">
              <label htmlFor="scopeMinistryId" className="block text-sm font-medium">
                Ministry
              </label>
              <select id="scopeMinistryId" name="scopeMinistryId" className={inputClassName} required>
                <option value="">Choose…</option>
                {ministries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!account && (
            <Field
              label="Email for the invitation"
              name="email"
              type="email"
              defaultValue={personEmail ?? ''}
              required
              errors={fieldErrors?.email}
            />
          )}
          <Button type="submit" size="sm" disabled={pending || !roleKey}>
            {pending ? 'Saving…' : account ? 'Add role' : 'Send invitation'}
          </Button>
        </form>
      )}
    </div>
  );
}
