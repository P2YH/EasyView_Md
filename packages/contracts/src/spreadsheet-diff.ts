/** Cell texts of one worksheet; trailing empty rows and cells are trimmed. */
export interface SpreadsheetSheetSnapshot { name: string; rows: string[][] }
/** `null` means the file does not exist on that side (added / deleted). */
export interface SpreadsheetComparison { base: SpreadsheetSheetSnapshot[] | null; content: SpreadsheetSheetSnapshot[] | null }

export type SpreadsheetChange = 'same' | 'added' | 'removed' | 'modified';
export interface SpreadsheetCellDiff { base: string; content: string; status: SpreadsheetChange }
/** `base` / `content` are 0-based row indexes in each version; absent on the side where the row does not exist. */
export interface SpreadsheetRowDiff { base?: number; content?: number; status: SpreadsheetChange; cells: SpreadsheetCellDiff[] }
export interface SpreadsheetSheetDiff { name: string; status: SpreadsheetChange; columns: number; rows: SpreadsheetRowDiff[]; changedRows: number; changedCells: number }

/** Above this many cell pairs the middle section is aligned by position instead of LCS. */
const LCS_BUDGET = 4_000_000;

export function diffSpreadsheets(comparison: SpreadsheetComparison): SpreadsheetSheetDiff[] {
  const base = comparison.base ?? [], content = comparison.content ?? [];
  const byName = new Map(base.map(sheet => [sheet.name, sheet]));
  const result: SpreadsheetSheetDiff[] = [];
  for (const sheet of content) {
    const previous = byName.get(sheet.name); byName.delete(sheet.name);
    result.push(diffSheet(sheet.name, previous?.rows ?? null, sheet.rows));
  }
  for (const sheet of byName.values()) result.push(diffSheet(sheet.name, sheet.rows, null));
  return result;
}

function diffSheet(name: string, base: string[][] | null, content: string[][] | null): SpreadsheetSheetDiff {
  const a = base ?? [], b = content ?? [];
  const columns = Math.max(0, ...a.map(row => row.length), ...b.map(row => row.length));
  const rows: SpreadsheetRowDiff[] = [];
  for (const [i, j] of alignRows(a.map(rowKey), b.map(rowKey))) rows.push(rowDiff(i === undefined ? undefined : a[i], j === undefined ? undefined : b[j], i, j, columns));
  const changedRows = rows.filter(row => row.status !== 'same').length;
  const changedCells = rows.reduce((sum, row) => sum + row.cells.filter(cell => cell.status !== 'same').length, 0);
  const status: SpreadsheetChange = !base ? 'added' : !content ? 'removed' : changedRows ? 'modified' : 'same';
  return { name, status, columns, rows, changedRows, changedCells };
}

function rowDiff(a: string[] | undefined, b: string[] | undefined, i: number | undefined, j: number | undefined, columns: number): SpreadsheetRowDiff {
  const cells: SpreadsheetCellDiff[] = [];
  for (let c = 0; c < columns; c++) {
    const before = a?.[c] ?? '', after = b?.[c] ?? '';
    const status: SpreadsheetChange = before === after ? 'same' : !a || (!before && b) ? 'added' : !b || !after ? 'removed' : 'modified';
    cells.push({ base: before, content: after, status });
  }
  const status: SpreadsheetChange = !a ? 'added' : !b ? 'removed' : cells.some(cell => cell.status !== 'same') ? 'modified' : 'same';
  return { ...(i === undefined ? {} : { base: i }), ...(j === undefined ? {} : { content: j }), status, cells };
}

const rowKey = (row: string[]): string => JSON.stringify(row);

/**
 * Aligns rows like a line diff. Within each changed hunk, removed and added rows are paired
 * positionally so an edited row shows as one modified row instead of a delete plus an insert.
 */
export function alignRows(a: string[], b: string[]): Array<[number | undefined, number | undefined]> {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const pairs: Array<[number | undefined, number | undefined]> = [];
  for (let k = 0; k < start; k++) pairs.push([k, k]);
  const n = endA - start, m = endB - start;
  if (n * m > LCS_BUDGET) pairHunk(pairs, start, endA, start, endB);
  else {
    // Suffix LCS lengths, (n+1) x (m+1).
    const width = m + 1, table = new Uint32Array((n + 1) * width);
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) {
      table[x * width + y] = a[start + x] === b[start + y] ? table[(x + 1) * width + y + 1] + 1 : Math.max(table[(x + 1) * width + y], table[x * width + y + 1]);
    }
    let x = 0, y = 0, hunkA = 0, hunkB = 0;
    while (x < n || y < m) {
      if (x < n && y < m && a[start + x] === b[start + y]) {
        pairHunk(pairs, start + hunkA, start + x, start + hunkB, start + y);
        pairs.push([start + x, start + y]); x++; y++; hunkA = x; hunkB = y;
      } else if (y >= m || (x < n && table[(x + 1) * width + y] >= table[x * width + y + 1])) x++;
      else y++;
    }
    pairHunk(pairs, start + hunkA, start + n, start + hunkB, start + m);
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

function pairHunk(pairs: Array<[number | undefined, number | undefined]>, fromA: number, toA: number, fromB: number, toB: number): void {
  const length = Math.max(toA - fromA, toB - fromB);
  for (let k = 0; k < length; k++) pairs.push([fromA + k < toA ? fromA + k : undefined, fromB + k < toB ? fromB + k : undefined]);
}

/** 0-based column index to spreadsheet letters (0 → A, 26 → AA). */
export function spreadsheetColumnName(index: number): string {
  let n = index + 1, out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
