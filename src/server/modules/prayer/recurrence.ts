/**
 * Recurrence rules now live in the shared scheduling module (docs/02 §10 `scheduling`), used by
 * both prayer and devotional schedules. Re-exported here so prayer imports stay unchanged.
 */
export * from '../scheduling/recurrence';
