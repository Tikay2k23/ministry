'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Result } from '@/server/errors';
import { cancelImportAction, commitImportAction } from './actions';

export function CommitPanel({ jobId, willCreate, errors }: { jobId: string; willCreate: number; errors: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (jobId: string) => Promise<Result<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await action(jobId);
      if (!result.ok) setError(result.error.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm">
        {willCreate > 0 ? (
          <>
            Ready to import <strong>{willCreate.toLocaleString('en-PH')}</strong> {willCreate === 1 ? 'person' : 'people'}. Everything is
            saved together — if anything goes wrong, nothing is saved.
          </>
        ) : (
          'Nothing in this file can be imported yet.'
        )}
        {errors > 0 && (
          <span className="block text-muted">
            {errors.toLocaleString('en-PH')} {errors === 1 ? 'row has' : 'rows have'} errors and won’t be imported. You can fix them in your
            spreadsheet and upload again, or import the rest now.
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run(commitImportAction)} disabled={pending || willCreate === 0}>
          {pending ? 'Working…' : `Import ${willCreate.toLocaleString('en-PH')} people`}
        </Button>
        <Button variant="ghost" onClick={() => run(cancelImportAction)} disabled={pending}>
          Cancel this import
        </Button>
      </div>
    </div>
  );
}
