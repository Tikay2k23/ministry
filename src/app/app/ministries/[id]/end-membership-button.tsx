'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { endMembershipAction } from '../actions';

export function EndMembershipButton({ membershipId, ministryId, name }: { membershipId: string; ministryId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        End
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-muted">End {name}’s serving here?</span>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await endMembershipAction(membershipId, ministryId);
            if (result.ok) router.refresh();
            else setError(result.error.message);
          })
        }
      >
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        No
      </Button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}
