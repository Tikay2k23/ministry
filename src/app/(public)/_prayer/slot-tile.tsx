'use client';

import { Check, CircleDashed, Clock, HandHeart, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { PublicSlot, PublicSlotState } from '@/server/modules/prayer/participation.service';

/**
 * One hour of the chain, as anyone may see it (docs/04 P6). It never says more about a person than
 * the chain publishes, and it never judges: an hour that ended without anyone marking it finished
 * reads as "Covered", because only a coordinator decides otherwise (BR-PR-04).
 */

const LOOK: Record<
  PublicSlotState,
  { label: string; note: string; icon: ComponentType<{ className?: string }>; card: string; text: string }
> = {
  open_now: {
    label: 'Open now',
    note: 'Be the one to pray this hour.',
    icon: Clock,
    card: 'border-brand-deep/40 bg-brand-leaf-tint/40',
    text: 'text-brand-deep',
  },
  available: {
    label: 'Open',
    note: '',
    icon: Clock,
    card: 'border-line bg-surface',
    text: 'text-brand-deep',
  },
  praying: {
    label: 'Praying now',
    note: 'Someone is praying this hour.',
    icon: HandHeart,
    card: 'border-status-received/40 bg-brand-leaf-tint/60',
    text: 'text-brand-deep',
  },
  reserved: {
    label: 'Taken',
    note: 'Someone has this hour.',
    icon: UserRound,
    card: 'border-line bg-ground/60',
    text: 'text-muted',
  },
  completed: {
    label: 'Prayed',
    note: 'This hour was prayed.',
    icon: Check,
    card: 'border-line bg-surface',
    text: 'text-status-received',
  },
  covered: {
    label: 'Covered',
    note: 'Someone had this hour.',
    icon: UserRound,
    card: 'border-line bg-surface',
    text: 'text-muted',
  },
  unfilled: {
    label: 'Not filled',
    note: 'Nobody prayed this hour.',
    icon: CircleDashed,
    card: 'border-dashed border-line bg-transparent',
    text: 'text-muted',
  },
};

function names(slot: PublicSlot): string | null {
  if (!slot.names || slot.names.length === 0) return null;
  const list = slot.names;
  return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function SlotTile({
  slot,
  onChoose,
  busy,
}: {
  slot: PublicSlot;
  onChoose: (slot: PublicSlot) => void;
  busy: boolean;
}) {
  const look = LOOK[slot.state];
  const Icon = look.icon;
  const who = names(slot);

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4',
        look.card,
        slot.mine && 'border-brand-deep ring-1 ring-brand-deep/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-[17px] font-bold leading-tight">{slot.label}</p>
        {slot.state === 'open_now' && (
          <span className="rounded-full bg-brand-deep px-2 py-0.5 text-xs font-semibold text-white">NOW</span>
        )}
        {slot.mine && slot.state !== 'open_now' && (
          <span className="rounded-full bg-brand-deep px-2 py-0.5 text-xs font-semibold text-white">
            Yours
          </span>
        )}
      </div>

      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', look.text)} />
        <div className="min-w-0">
          <p className={cn('font-medium', look.text)}>{look.label}</p>
          {/* A name only ever appears when the coordinator publishes first names. */}
          {(who ?? look.note) && <p className="text-base text-muted">{who ?? look.note}</p>}
          {slot.capacity > 1 && slot.claimable && (
            <p className="text-base text-muted">
              {slot.placesLeft} of {slot.capacity} places left
            </p>
          )}
        </div>
      </div>

      {slot.claimable && !slot.mine && (
        <Button variant="secondary" className="w-full" onClick={() => onChoose(slot)} disabled={busy}>
          Choose this hour
        </Button>
      )}
    </li>
  );
}
