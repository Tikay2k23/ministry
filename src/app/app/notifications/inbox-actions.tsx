'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { markReadAction } from './actions';

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markReadAction({ ids: [id] });
          router.refresh();
        })
      }
    >
      Mark as read
    </Button>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markReadAction({ all: true });
          router.refresh();
        })
      }
    >
      {pending ? 'Marking…' : 'Mark all as read'}
    </Button>
  );
}

/** Opens the page a notification points to, and marks it read on the way. */
export function OpenNotificationLink({ id, href, label, unread }: { id: string; href: string; label: string; unread: boolean }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link
        href={href}
        onClick={() => {
          if (unread) void markReadAction({ ids: [id] });
        }}
      >
        {label}
      </Link>
    </Button>
  );
}
