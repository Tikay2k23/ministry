'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { reviewEntryAction } from '../../actions';

type FollowUp = 'none' | 'leadership' | 'pastoral';

const FOLLOW_UP_OPTIONS: { value: FollowUp; label: string; hint: string }[] = [
  { value: 'none', label: 'No follow-up needed', hint: '' },
  { value: 'leadership', label: 'I’ll follow up personally', hint: 'Adds it to your follow-ups.' },
  { value: 'pastoral', label: 'Ask a pastor to follow up', hint: 'Only pastors see pastoral follow-ups.' },
];

export function ReviewForm({
  entryId,
  personId,
  personFirstName,
  existingComment,
  alreadyReviewed,
}: {
  entryId: string;
  personId: string;
  personFirstName: string;
  existingComment: string | null;
  alreadyReviewed: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState(existingComment ?? '');
  const [followUp, setFollowUp] = useState<FollowUp>('none');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await reviewEntryAction({ entryId, personId, comment, followUp });
      if (result.ok) {
        setSaved(true);
        setFollowUp('none');
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="review-comment" className="block text-sm font-medium">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="review-comment"
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Something to remember or pray about"
          aria-describedby="review-comment-hint"
          className={cn(inputClassName, 'h-auto py-2')}
        />
        <p id="review-comment-hint" className="text-sm text-muted">
          Only leaders who can read this journal see the note — {personFirstName} doesn’t.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Follow-up</legend>
        {FOLLOW_UP_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="followUp"
              value={option.value}
              checked={followUp === option.value}
              onChange={() => setFollowUp(option.value)}
              className="mt-0.5 size-4 accent-brand-deep"
            />
            <span>
              {option.label}
              {option.hint && <span className="block text-muted">{option.hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Review saved.</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : alreadyReviewed ? 'Update review' : 'Mark as reviewed'}
      </Button>
    </form>
  );
}
