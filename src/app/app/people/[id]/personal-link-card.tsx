'use client';

import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { issuePersonalLinkAction, revokeDevicesAction } from './journal-actions';

interface IssuedLink {
  url: string;
  expiresAt: Date;
  phone: string | null;
}

export function PersonalLinkCard({ personId, firstName }: { personId: string; firstName: string }) {
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const issue = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      setCopied(false);
      const result = await issuePersonalLinkAction(personId);
      if (result.ok) setLink(result.data);
      else setError(result.error.message);
    });

  const revoke = () => {
    if (!window.confirm(`Sign ${firstName} out of every phone? They’ll need to identify themselves again next time.`)) return;
    startTransition(async () => {
      setError(null);
      const result = await revokeDevicesAction(personId);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const n = result.data.revoked;
      setMessage(n === 0 ? 'No phones were remembered.' : `Signed out of ${n} phone${n === 1 ? '' : 's'}.`);
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const smsBody = link ? `Hi ${firstName}! Here’s your personal link for the GenTouch Daily Journal: ${link.url}` : '';

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        A personal link opens the journal on {firstName}’s phone without typing anything. It works once and expires in 7 days.
      </p>
      {link ? (
        <div className="space-y-2">
          <label htmlFor={`link-${personId}`} className="sr-only">
            Personal link
          </label>
          <input id={`link-${personId}`} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={`${inputClassName} text-sm`} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {link.phone && (
              <Button asChild size="sm" variant="secondary">
                <a href={`sms:${link.phone.replace(/\s+/g, '')}?body=${encodeURIComponent(smsBody)}`}>Send by SMS</a>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">Send it only to {firstName} — anyone with the link can journal as them until it’s used.</p>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={issue} disabled={pending}>
          {pending ? 'Creating…' : 'Create personal link'}
        </Button>
      )}
      <button type="button" onClick={revoke} disabled={pending} className="block text-sm text-error hover:underline disabled:opacity-50">
        Sign out of all phones
      </button>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
