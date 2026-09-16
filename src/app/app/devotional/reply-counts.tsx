/** Replies on a roster at a glance (docs/04 A19): "5 ✓ · 1 ◷ · 0 ✗", read out in words. */
export function ReplyCounts({ confirmed, pending, declined }: { confirmed: number; pending: number; declined: number }) {
  return (
    <span className="tabular text-sm">
      <span aria-hidden>
        <span className="text-brand-deep">{confirmed} ✓</span> · {pending} ◷ · {declined} ✗
      </span>
      <span className="sr-only">
        {confirmed} confirmed, {pending} waiting for a reply, {declined} can’t serve
      </span>
    </span>
  );
}
