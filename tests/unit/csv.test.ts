import { describe, expect, it } from 'vitest';
import { csvFilename, safeCell, toCsv } from '@/server/modules/reports/csv';

describe('CSV export', () => {
  it('neutralises spreadsheet formulas in text cells', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(safeCell('+639171234567')).toBe(`'+639171234567`);
    expect(safeCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(safeCell('Grace Mendoza')).toBe('Grace Mendoza');
    expect(safeCell(-3)).toBe('-3');
    expect(safeCell(null)).toBe('');
  });

  it('writes a BOM, CRLF line endings and proper quoting', () => {
    const csv = toCsv(['Name', 'Note'], [['Cruz, John', 'He said "amen"'], ['Niño', '=1+1']]);
    expect(csv.startsWith('﻿Name,Note\r\n')).toBe(true);
    expect(csv).toContain('"Cruz, John","He said ""amen"""');
    expect(csv).toContain(`Niño,'=1+1`);
  });

  it('builds safe filenames', () => {
    expect(csvFilename('journal', '2026-09-15', 'to', '2026-09-16')).toBe('journal-2026-09-15-to-2026-09-16.csv');
    expect(csvFilename('People / Mark’s group')).toBe('people-mark-s-group.csv');
  });
});
