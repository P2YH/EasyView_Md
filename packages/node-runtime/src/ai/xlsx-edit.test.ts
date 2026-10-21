import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  XLSX_MAX_OPS,
  XLSX_MAX_RANGE_CELLS,
  parseRange,
  commitXlsxProposal,
  diffWorkbookGrids,
  fingerprintBytes,
  inspectXlsxFile,
  planXlsxEdit,
  undoXlsxCommit,
  xlsxSheetOpsSchema,
  type XlsxCellValue,
} from './xlsx-edit';
import { createOfficeAgentTools, officeDocumentKind } from './office-tools';
import { OfficeBackupStore, readOfficeBackup } from './office-backups';

async function makeWorkbook(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales');
  sheet.addRow(['Name', 'Qty', 'Price']);
  sheet.addRow(['Apple', 3, 2]);
  sheet.addRow(['Pear', 5, 4]);
  workbook.addWorksheet('Notes').addRow(['hello']);
  await workbook.xlsx.writeFile(filePath);
}

async function readCell(filePath: string, sheet: string, ref: string): Promise<ExcelJS.CellValue> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.getWorksheet(sheet)!.getCell(ref).value;
}

describe('xlsx edit core', () => {
  let root = '';
  let file = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'easyview-xlsx-'));
    file = path.join(root, 'book.xlsx');
    await makeWorkbook(file);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('inspects sheets, used range, headers, rows and a stable fingerprint', async () => {
    const result = await inspectXlsxFile(file, 1);
    expect(result.fingerprint).toBe(fingerprintBytes(await readFile(file)));
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(['Sales', 'Notes']);
    expect(result.sheets[0]).toMatchObject({ usedRange: 'A1:C3', headers: ['Name', 'Qty', 'Price'], rows: [{ row: 2, values: ['Apple', 3, 2] }] });
  });

  it('rejects non-xlsx paths', async () => {
    const txt = path.join(root, 'a.txt');
    await writeFile(txt, 'x');
    await expect(inspectXlsxFile(txt)).rejects.toThrow();
    expect(officeDocumentKind(txt)).toBeNull();
    expect(officeDocumentKind(file)).toBe('xlsx');
  });

  it('validates ops: limit, address format, value xor formula', () => {
    const op = { op: 'setCell', sheet: 'Sales', ref: 'B2', value: 1 };
    expect(xlsxSheetOpsSchema.safeParse([op]).success).toBe(true);
    expect(XLSX_MAX_OPS).toBe(30_000);
    expect(xlsxSheetOpsSchema.safeParse(Array(XLSX_MAX_OPS).fill(op)).success).toBe(true);
    expect(xlsxSheetOpsSchema.safeParse(Array(XLSX_MAX_OPS + 1).fill(op)).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ ...op, ref: 'b2' }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ ...op, formula: 'A1' }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setCell', sheet: 'Sales', ref: 'B2' }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([]).success).toBe(false);
  });

  it('plans in memory with a cell diff and does not write', async () => {
    const before = await readFile(file);
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [
      { op: 'setCell', sheet: 'Sales', ref: 'B2', value: 10 },
      { op: 'setCell', sheet: 'Sales', ref: 'D2', formula: '=B2*C2' },
    ]);
    expect(proposal.diff.changes).toEqual([
      { sheet: 'Sales', ref: 'B2', before: 3, after: 10 },
      { sheet: 'Sales', ref: 'D2', before: null, after: '=B2*C2' },
    ]);
    expect(Buffer.compare(await readFile(file), before)).toBe(0);
  });

  it('reports row insert/delete as structural changes', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [
      { op: 'deleteRows', sheet: 'Sales', at: 2, count: 1 },
      { op: 'insertRows', sheet: 'Sales', at: 3, rows: [['Kiwi', 1, 9]] },
    ]);
    expect(proposal.diff.structural).toHaveLength(2);
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'A2', before: 'Apple', after: 'Pear' });
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'A3', before: 'Pear', after: 'Kiwi' });
  });

  it('rejects unknown sheets and stale fingerprints', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    await expect(planXlsxEdit(file, fingerprint, [{ op: 'setCell', sheet: 'Nope', ref: 'A1', value: 1 }])).rejects.toThrow(/Nope/);
    await expect(planXlsxEdit(file, 'deadbeef', [{ op: 'setCell', sheet: 'Sales', ref: 'A1', value: 1 }])).rejects.toThrow();
  });

  it('commits with backup, refuses if changed externally, and undoes', async () => {
    const original = await readFile(file);
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 42 }]);
    const backups = new OfficeBackupStore(path.join(root, 'app-data'));
    const record = await commitXlsxProposal(proposal, backups, new Date('2026-10-21T00:00:00Z'));
    expect(record.backup).toMatchObject({ kind: 'file' });
    expect(Buffer.compare(await readOfficeBackup(record.backup), original)).toBe(0);
    expect(await readdir(root)).not.toContain('.easyview');
    expect(await readCell(file, 'Sales', 'B2')).toBe(42);
    await expect(commitXlsxProposal(proposal, backups)).rejects.toThrow();
    await undoXlsxCommit(record);
    expect(Buffer.compare(await readFile(file), original)).toBe(0);
  });

  it('refuses undo once the file changed after the commit', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 42 }]);
    const record = await commitXlsxProposal(proposal, new OfficeBackupStore(path.join(root, 'app-data')));
    await makeWorkbook(file);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([0])]));
    await expect(undoXlsxCommit(record)).rejects.toThrow();
  });

  it('diffs grids including removed sheets', () => {
    const result = diffWorkbookGrids(new Map([['S', new Map<string, XlsxCellValue>([['A1', 1], ['B10', 'x']])]]), new Map([['S', new Map<string, XlsxCellValue>([['A1', 2]])]]));
    expect(result.changes).toEqual([{ sheet: 'S', ref: 'A1', before: 1, after: 2 }, { sheet: 'S', ref: 'B10', before: 'x', after: null }]);
  });
});

describe('xlsx range ops and scale', () => {
  let root = '';
  let file = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'easyview-xlsx-range-'));
    file = path.join(root, 'book.xlsx');
    await makeWorkbook(file);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('parses ranges in any corner order', () => {
    expect(parseRange('C5:A2')).toEqual({ top: 2, left: 1, bottom: 5, right: 3, cells: 12 });
    expect(parseRange('B7').cells).toBe(1);
  });

  it('setRange fills values and {row} formulas', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [
      { op: 'setCell', sheet: 'Sales', ref: 'D1', value: 'Total' },
      { op: 'setRange', sheet: 'Sales', range: 'D2:D3', formula: '=B{row}*C{row}' },
      { op: 'setRange', sheet: 'Notes', range: 'B1:C2', value: 'x' },
    ]);
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'D2', before: null, after: '=B2*C2' });
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'D3', before: null, after: '=B3*C3' });
    expect(proposal.diff.total).toBe(7);
  });

  it('setRange values fills each cell from a matching grid', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [
      { op: 'setRange', sheet: 'Sales', range: 'A4:C5', values: [['Kiwi', 1, 2], ['Plum', 3, 4]] },
    ]);
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'A4', before: null, after: 'Kiwi' });
    expect(proposal.diff.changes).toContainEqual({ sheet: 'Sales', ref: 'C5', before: null, after: 4 });
    expect(proposal.diff.total).toBe(6);
  });

  it('rejects setRange values with the wrong shape and multi-line values copied into a range', () => {
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setRange', sheet: 'Sales', range: 'A4:C5', values: [['Kiwi', 1]] }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setRange', sheet: 'Sales', range: 'A4:B4', value: 1, values: [[1, 2]] }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setRange', sheet: 'Sales', range: 'A4:E13', value: 'A-030\t示例功能30\nA-031\t示例功能31' }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setRange', sheet: 'Sales', range: 'A4', value: 'line1\nline2' }]).success).toBe(true);
  });

  it('transformRange multiplies numbers, replaces text and skips other types', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [
      { op: 'transformRange', sheet: 'Sales', range: 'A1:C3', transform: 'multiply', number: 10 },
      { op: 'transformRange', sheet: 'Sales', range: 'A2:A3', transform: 'replaceText', find: 'P', text: 'B' },
    ]);
    expect(proposal.diff.changes).toEqual([
      { sheet: 'Sales', ref: 'B2', before: 3, after: 30 },
      { sheet: 'Sales', ref: 'C2', before: 2, after: 20 },
      { sheet: 'Sales', ref: 'A3', before: 'Pear', after: 'Bear' },
      { sheet: 'Sales', ref: 'B3', before: 5, after: 50 },
      { sheet: 'Sales', ref: 'C3', before: 4, after: 40 },
    ]);
  });

  it('replaceWhere sets a column where another column matches', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [{ op: 'replaceWhere', sheet: 'Sales', matchColumn: 'A', equals: 'Pear', setColumn: 'C', value: 9 }]);
    expect(proposal.diff.changes).toEqual([{ sheet: 'Sales', ref: 'C3', before: 4, after: 9 }]);
  });

  it('rejects range ops above the cell cap and bad arguments', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    await expect(planXlsxEdit(file, fingerprint, [{ op: 'setRange', sheet: 'Sales', range: 'A1:Z100000', value: 1 }])).rejects.toThrow(String(XLSX_MAX_RANGE_CELLS));
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'transformRange', sheet: 'Sales', range: 'A1:B2', transform: 'multiply' }]).success).toBe(false);
    expect(xlsxSheetOpsSchema.safeParse([{ op: 'setRange', sheet: 'Sales', range: 'A1:B', value: 1 }]).success).toBe(false);
  });

  it('handles 30000 ops on a 20000-row sheet with a counted, capped diff', async () => {
    const big = path.join(root, 'big.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    sheet.addRow(['id', 'qty', 'price']);
    for (let i = 1; i <= 20_000; i += 1) sheet.addRow([`R${i}`, i, i * 2]);
    await workbook.xlsx.writeFile(big);
    const { fingerprint } = await inspectXlsxFile(big, 5);
    const ops = Array.from({ length: XLSX_MAX_OPS }, (_, i) => ({ op: 'setCell' as const, sheet: 'Data', ref: `D${i + 2}`, value: i }));
    const started = Date.now();
    const proposal = await planXlsxEdit(big, fingerprint, ops);
    const elapsed = Date.now() - started;
    expect(proposal.diff.total).toBe(XLSX_MAX_OPS);
    expect(proposal.diff.changes).toHaveLength(1000);
    expect(proposal.diff.truncated).toBe(true);
    expect(proposal.diff.changes[0]).toEqual({ sheet: 'Data', ref: 'D2', before: null, after: 0 });
    expect(elapsed).toBeLessThan(30_000);
    const ranged = await planXlsxEdit(big, fingerprint, [{ op: 'transformRange', sheet: 'Data', range: 'C2:C20001', transform: 'multiply', number: 1.1 }]);
    expect(ranged.diff.total).toBe(20_000);
  }, 120_000);
});

describe('office agent tools', () => {
  let root = '';
  let file = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'easyview-xlsx-tools-'));
    file = path.join(root, 'book.xlsx');
    await makeWorkbook(file);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const run = (tools: ReturnType<typeof createOfficeAgentTools>, name: string, input: unknown) =>
    (tools[name]!.execute as (value: unknown, options: unknown) => Promise<any>)(input, { toolCallId: 't', messages: [] });

  it('has no path parameter and writes only after acceptance', async () => {
    const original = await readFile(file);
    let decision = false;
    const shown: unknown[] = [];
    const tools = createOfficeAgentTools({
      kind: 'xlsx', filePath: file, backups: new OfficeBackupStore(path.join(root, 'app-data')),
      confirmEdit: async (proposal) => { shown.push(proposal); return { accepted: decision }; },
    });
    const inspected = await run(tools, 'inspect_workbook', { path: '/etc/passwd' });
    expect(inspected.fileName).toBe('book.xlsx');
    const ops = [{ op: 'setCell', sheet: 'Sales', ref: 'C3', value: 99 }];
    expect(await run(tools, 'apply_sheet_ops', { fingerprint: inspected.fingerprint, ops })).toMatchObject({ status: 'rejected' });
    expect(Buffer.compare(await readFile(file), original)).toBe(0);
    decision = true;
    expect(await run(tools, 'apply_sheet_ops', { fingerprint: inspected.fingerprint, ops })).toMatchObject({ status: 'applied', changedCells: 1 });
    expect(await readCell(file, 'Sales', 'C3')).toBe(99);
    expect(shown).toHaveLength(2);
    expect(await readdir(path.join(root, 'app-data'))).toHaveLength(1);
  });

  it('returns no-change without asking the user', async () => {
    let asked = false;
    const tools = createOfficeAgentTools({ kind: 'xlsx', filePath: file, backups: new OfficeBackupStore(path.join(root, 'app-data')), confirmEdit: async () => { asked = true; return { accepted: true }; } });
    const { fingerprint } = await run(tools, 'inspect_workbook', {});
    expect(await run(tools, 'apply_sheet_ops', { fingerprint, ops: [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 3 }] })).toEqual({ status: 'no-change' });
    expect(asked).toBe(false);
  });
});
