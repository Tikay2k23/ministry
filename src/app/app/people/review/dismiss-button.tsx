'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { dismissDuplicateAction } from './actions';

export function DismissButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-error">{error}</span>}
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await dismissDuplicateAction(candidateId);
            if (result.ok) router.refresh();
            else setError(result.error.message);
          })
        }
      >
        Not the same person
      </Button>
    </span>
  );
}
