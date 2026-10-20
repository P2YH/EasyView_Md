import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  XLSX_MAX_OPS,
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
    const record = await commitXlsxProposal(proposal, root, new Date('2026-10-21T00:00:00Z'));
    expect(record.backupPath.startsWith(path.join(root, '.easyview', 'ai-backups'))).toBe(true);
    expect(Buffer.compare(await readFile(record.backupPath), original)).toBe(0);
    expect(await readCell(file, 'Sales', 'B2')).toBe(42);
    await expect(commitXlsxProposal(proposal, root)).rejects.toThrow();
    await undoXlsxCommit(record);
    expect(Buffer.compare(await readFile(file), original)).toBe(0);
  });

  it('refuses undo once the file changed after the commit', async () => {
    const { fingerprint } = await inspectXlsxFile(file);
    const proposal = await planXlsxEdit(file, fingerprint, [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 42 }]);
    const record = await commitXlsxProposal(proposal, root);
    await makeWorkbook(file);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([0])]));
    await expect(undoXlsxCommit(record)).rejects.toThrow();
  });

  it('diffs grids including removed sheets', () => {
    const result = diffWorkbookGrids(new Map([['S', new Map<string, XlsxCellValue>([['A1', 1], ['B10', 'x']])]]), new Map([['S', new Map<string, XlsxCellValue>([['A1', 2]])]]));
    expect(result.changes).toEqual([{ sheet: 'S', ref: 'A1', before: 1, after: 2 }, { sheet: 'S', ref: 'B10', before: 'x', after: null }]);
  });
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
      kind: 'xlsx', filePath: file, backupRoot: root,
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
    expect(await readdir(path.join(root, '.easyview', 'ai-backups'))).toHaveLength(1);
  });

  it('returns no-change without asking the user', async () => {
    let asked = false;
    const tools = createOfficeAgentTools({ kind: 'xlsx', filePath: file, backupRoot: root, confirmEdit: async () => { asked = true; return { accepted: true }; } });
    const { fingerprint } = await run(tools, 'inspect_workbook', {});
    expect(await run(tools, 'apply_sheet_ops', { fingerprint, ops: [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 3 }] })).toEqual({ status: 'no-change' });
    expect(asked).toBe(false);
  });
});
