/**
 * Choices shown to participants on the public prayer pages (docs/04 P7). Kept apart from the
 * schema code so those mobile pages don't have to download it.
 */

/** "I can't make it": a short reason for the coordinator, never a detailed explanation. */
export const CANNOT_MAKE_IT_REASONS = ['unwell', 'travel', 'work', 'family', 'other'] as const;
export type CannotMakeItReason = (typeof CANNOT_MAKE_IT_REASONS)[number];

export const CANNOT_MAKE_IT_LABELS: Record<CannotMakeItReason, string> = {
  unwell: 'I’m unwell',
  travel: 'I’m travelling',
  work: 'Work',
  family: 'Family',
  other: 'Something else',
};
