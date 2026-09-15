'use client';

import { Printer, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { rotateJournalCodeAction } from '../journal-actions';

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" /> Print
    </Button>
  );
}

export function RotateCodeButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rotate = () => {
    if (!window.confirm('Make a new QR code? Printed copies of the current code will stop working.')) return;
    startTransition(async () => {
      setError(null);
      const result = await rotateJournalCodeAction(personId);
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });
  };

  return (
    <>
      <Button variant="ghost" onClick={rotate} disabled={pending}>
        <RefreshCw aria-hidden className="size-4" /> {pending ? 'Replacing…' : 'Replace code'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}
