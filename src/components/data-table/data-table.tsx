'use client';

import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * A table over rows that are already on the page (TanStack Table v9 on the shared Table parts).
 * Columns sort in the browser; paging and filtering stay on the server through the URL, as on the
 * People page, so the browser never holds more than one page of personal data.
 *
 * Define the columns in a client component with the helper bound to these features:
 *   const column = createDataTableColumnHelper<ChainRow>();
 *   const columns = column.columns([column.accessor('name', { header: 'Name' })]);
 */

export const dataTableFeatures = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

export type DataTableFeatures = typeof dataTableFeatures;

export const createDataTableColumnHelper = <TData extends RowData>() => createColumnHelper<DataTableFeatures, TData>();

// Each column has its own value type, which TanStack's own column arrays express as `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  caption,
  empty = 'Nothing to show yet.',
}: {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  /** Describes the table for screen readers. */
  caption?: string;
  empty?: ReactNode;
}) {
  const table = useTable({ features: dataTableFeatures, columns, data, getRowId });
  const rows = table.getRowModel().rows;

  return (
    <Table>
      {caption && <caption className="sr-only">{caption}</caption>}
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              return (
                <TableHead key={header.id} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-ink"
                    >
                      <table.FlexRender header={header} />
                      {sorted === 'asc' ? (
                        <ArrowUp aria-hidden className="size-3.5" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown aria-hidden className="size-3.5" />
                      ) : (
                        <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
                      )}
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="py-10 text-center text-muted">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
