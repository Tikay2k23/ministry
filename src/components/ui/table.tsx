import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table parts (shadcn/ui), styled like the existing portal tables (e.g. People) so old and new
 * screens match. Works in Server Components; for sorting in the browser, see
 * src/components/data-table/data-table.tsx.
 */

function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table data-slot="table" className={cn('w-full caption-bottom text-left text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('border-b border-line text-xs tracking-wider text-muted uppercase', className)} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('divide-y divide-line', className)} {...props} />;
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('border-t border-line bg-ground font-medium', className)} {...props} />;
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('transition-colors hover:bg-ground/60 has-aria-expanded:bg-ground/60 data-[state=selected]:bg-brand-leaf-tint', className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th data-slot="table-head" className={cn('px-4 py-3 align-middle font-semibold whitespace-nowrap', className)} {...props} />;
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-3 align-middle', className)} {...props} />;
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted', className)} {...props} />;
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
