'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { publishRostersAction } from './actions';

type PublishResult = Extract<Awaited<ReturnType<typeof publishRostersAction>>, { ok: true }>['data'];

/**
 * Publishes draft rosters (docs/05 W8 step 6: "publish the whole week", or one gathering). Rosters with
 * required roles still open are listed first, and published only when the coordinator says so.
 */
export function PublishRostersButton({ gatheringIds, label, size = 'md' }: { gatheringIds: string[]; label: string; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const [needsForce, setNeedsForce] = useState<PublishResult['needsForce']>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const publish = (ids: string[], force: boolean) =>
    startTransition(async () => {
      setMessage(null);
      const result = await publishRostersAction({ gatheringIds: ids, force });
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error.message });
        return;
      }
      setNeedsForce(result.data.needsForce);
      const published = result.data.published.length;
      if (published > 0) {
        setMessage({ tone: 'success', text: published === 1 ? 'Roster published. Everyone on it will get their personal link.' : `${published} rosters published. Everyone on them will get their personal link.` });
      }
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <Button size={size} disabled={pending} onClick={() => publish(gatheringIds, false)}>
        <Send aria-hidden className="size-4" /> {pending ? 'Publishing…' : label}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Dialog open={needsForce.length > 0} onOpenChange={(open) => !open && setNeedsForce([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Some roles are still open</DialogTitle>
            <DialogDescription>These rosters still need people. You can publish them now and fill the gaps later.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {needsForce.map((item) => (
              <li key={item.gatheringId} className="rounded-lg bg-ground px-3 py-2">
                <p className="font-medium">
                  {item.name}, {item.dateLabel}
                </p>
                <p className="text-sm text-muted">Open: {item.openRoles.join(', ')}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNeedsForce([])}>
              Not yet
            </Button>
            <Button disabled={pending} onClick={() => publish(needsForce.map((item) => item.gatheringId), true)}>
              {pending ? 'Publishing…' : 'Publish anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
