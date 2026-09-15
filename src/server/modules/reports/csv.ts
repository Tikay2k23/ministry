import Papa from 'papaparse';

/**
 * CSV for spreadsheet users (Excel, Google Sheets). Text cells that a spreadsheet would treat
 * as a formula are prefixed with an apostrophe (OWASP "CSV injection"), a UTF-8 BOM makes
 * Excel read accents and ñ correctly, and lines end with CRLF.
 */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `﻿${Papa.unparse({ fields: headers.map(safeCell), data: rows.map((row) => row.map(safeCell)) }, { newline: '\r\n' })}`;
}

/** A filename-safe slug for Content-Disposition. */
export function csvFilename(...parts: string[]): string {
  return `${parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}.csv`;
}
