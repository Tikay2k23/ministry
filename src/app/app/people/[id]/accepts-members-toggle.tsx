'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setAcceptsMembersAction } from './actions';

/** "Shown in leader selector" with a switch for people who manage this part of the structure. */
export function AcceptsMembersToggle({ personId, firstName, acceptsMembers }: { personId: string; firstName: string; acceptsMembers: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      setError(null);
      const result = await setAcceptsMembersAction(personId, !acceptsMembers);
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        {acceptsMembers ? 'Yes' : 'No'}
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="text-sm font-medium text-brand-deep hover:underline disabled:text-muted disabled:no-underline"
        >
          {pending ? 'Saving…' : acceptsMembers ? 'Turn off' : 'Turn on'}
          <span className="sr-only"> showing {firstName} in the leader selector</span>
        </button>
      </span>
      {error && (
        <span role="alert" className="mt-1 block font-normal text-error">
          {error}
        </span>
      )}
    </>
  );
}
