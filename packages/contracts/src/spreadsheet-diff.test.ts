import { describe, expect, it } from 'vitest';
import { alignRows, diffSpreadsheets, spreadsheetColumnName } from './spreadsheet-diff';

describe('alignRows', () => {
  it('keeps rows below an inserted row aligned', () => {
    expect(alignRows(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual([[0, 0], [undefined, 1], [1, 2], [2, 3]]);
  });
  it('pairs an edited row instead of reporting a delete plus an insert', () => {
    expect(alignRows(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
  it('reports removed rows at the end', () => {
    expect(alignRows(['a', 'b', 'c'], ['a'])).toEqual([[0, 0], [1, undefined], [2, undefined]]);
  });
});

describe('diffSpreadsheets', () => {
  it('classifies changed, added and removed cells, rows and sheets', () => {
    const [orders, added, removed] = diffSpreadsheets({
      base: [{ name: 'Orders', rows: [['id', 'qty'], ['1', '5'], ['2', '7']] }, { name: 'Old', rows: [['x']] }],
      content: [{ name: 'Orders', rows: [['id', 'qty', 'note'], ['1', '6'], ['3', '9'], ['2', '7']] }, { name: 'New', rows: [] }],
    });
    expect(orders).toMatchObject({ name: 'Orders', status: 'modified', columns: 3 });
    expect(orders.rows.map(row => row.status)).toEqual(['modified', 'modified', 'added', 'same']);
    expect(orders.rows[0].cells[2]).toEqual({ base: '', content: 'note', status: 'added' });
    expect(orders.rows[1].cells[1]).toEqual({ base: '5', content: '6', status: 'modified' });
    expect(orders.rows[2]).toMatchObject({ content: 2, status: 'added' });
    expect(orders.rows[2].base).toBeUndefined();
    expect(orders.changedRows).toBe(3);
    expect(orders.changedCells).toBe(4);
    expect(added).toMatchObject({ name: 'New', status: 'added' });
    expect(removed).toMatchObject({ name: 'Old', status: 'removed', changedRows: 1 });
  });
  it('treats a missing file side as an added or deleted workbook', () => {
    const [sheet] = diffSpreadsheets({ base: null, content: [{ name: 'S', rows: [['a']] }] });
    expect(sheet).toMatchObject({ status: 'added', changedCells: 1 });
  });
});

it('names columns like a spreadsheet', () => {
  expect([0, 25, 26, 701, 702].map(spreadsheetColumnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
});
