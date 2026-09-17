'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { runJobSoonAction } from '../actions';

/** "Run now": the job runs at the next scheduler tick, within about a minute. */
export function RunJobButton({ jobKey, label }: { jobKey: string; label: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Run “${label}” now`}
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await runJobSoonAction({ jobKey });
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            setDone(true);
            router.refresh();
          })
        }
      >
        {done ? 'Runs within a minute' : pending ? 'Asking…' : 'Run now'}
      </Button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}
