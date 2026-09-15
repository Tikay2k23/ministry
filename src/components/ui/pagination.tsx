import Link from 'next/link';
import { cn } from '@/lib/cn';

type Params = Record<string, string | number | boolean | undefined | null>;

export function buildHref(basePath: string, params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Server-rendered pagination; keeps the current filters in the URL. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Params;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = (target: number, label: string, disabled: boolean) =>
    disabled ? (
      <span className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted/60" aria-disabled="true">
        {label}
      </span>
    ) : (
      <Link
        href={buildHref(basePath, { ...params, page: target > 1 ? target : undefined })}
        className={cn('rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-ground')}
      >
        {label}
      </Link>
    );

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="tabular text-muted">
        Showing {from.toLocaleString('en-PH')}–{to.toLocaleString('en-PH')} of {total.toLocaleString('en-PH')}
      </p>
      <div className="flex items-center gap-2">
        {link(page - 1, 'Previous', page <= 1)}
        <span className="tabular px-2 text-muted">
          Page {page} of {pages}
        </span>
        {link(page + 1, 'Next', page >= pages)}
      </div>
    </nav>
  );
}
