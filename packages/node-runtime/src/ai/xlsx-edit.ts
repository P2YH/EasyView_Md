/**
 * Excel (.xlsx) editing core for AI Agent mode.
 *
 * Every edit is staged in memory first: callers get a cell-level diff and a
 * proposal; only `commitXlsxProposal` touches disk, after re-checking the
 * fingerprint, backing up the original, and writing atomically. `undoXlsxCommit`
 * restores the backup as long as the file was not changed after the commit.
 */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { writeFileAtomically } from '../filesystem/file-write';
import { tAi } from './ai.i18n';

export const XLSX_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const XLSX_MAX_OPS = 200;
export const XLSX_MAX_DIFF_ENTRIES = 1000;
export const XLSX_DEFAULT_PREVIEW_ROWS = 20;
export const XLSX_MAX_PREVIEW_ROWS = 200;
export const XLSX_MAX_PREVIEW_COLUMNS = 50;
export const XLSX_OPERATION_TIMEOUT_MS = 30_000;

const CELL_REF = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
const cellValueSchema = z.union([z.string().max(32_767), z.number().finite(), z.boolean(), z.null()]);
const sheetName = z.string().min(1).max(31);

export const xlsxSheetOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setCell'),
    sheet: sheetName,
    ref: z.string().regex(CELL_REF),
    value: cellValueSchema.optional(),
    formula: z.string().min(1).max(8192).optional(),
  }).refine((op) => (op.value === undefined) !== (op.formula === undefined), { message: 'setCell needs exactly one of value or formula' }),
  z.object({
    op: z.literal('insertRows'),
    sheet: sheetName,
    at: z.number().int().min(1).max(1_048_576),
    rows: z.array(z.array(cellValueSchema).max(XLSX_MAX_PREVIEW_COLUMNS * 10)).min(1).max(500),
  }),
  z.object({
    op: z.literal('deleteRows'),
    sheet: sheetName,
    at: z.number().int().min(1).max(1_048_576),
    count: z.number().int().min(1).max(500),
  }),
  z.object({
    op: z.literal('setStyle'),
    sheet: sheetName,
    ref: z.string().regex(CELL_REF),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    fillColor: z.string().regex(/^#?[0-9A-Fa-f]{6}$/).optional(),
    numFmt: z.string().min(1).max(100).optional(),
  }),
]);
export const xlsxSheetOpsSchema = z.array(xlsxSheetOpSchema).min(1).max(XLSX_MAX_OPS);
export type XlsxSheetOp = z.infer<typeof xlsxSheetOpSchema>;

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxSheetSummary {
  name: string;
  usedRange: string | null;
  rowCount: number;
  columnCount: number;
  headers: XlsxCellValue[];
  rows: Array<{ row: number; values: XlsxCellValue[] }>;
}

export interface XlsxInspection {
  fileName: string;
  fingerprint: string;
  sheets: XlsxSheetSummary[];
}

export interface XlsxCellChange {
  sheet: string;
  ref: string;
  before: XlsxCellValue;
  after: XlsxCellValue;
}

export interface XlsxDiff {
  changes: XlsxCellChange[];
  truncated: boolean;
  /** Row-structure summary per op so the UI can explain shifted rows. */
  structural: string[];
}

export interface XlsxProposal {
  id: string;
  filePath: string;
  baseFingerprint: string;
  nextFingerprint: string;
  buffer: Buffer;
  diff: XlsxDiff;
  ops: XlsxSheetOp[];
}

export interface XlsxCommitRecord {
  filePath: string;
  backupPath: string;
  writtenFingerprint: string;
}

export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export function isXlsxPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.xlsx';
}

async function readXlsxBytes(filePath: string): Promise<Buffer> {
  if (!isXlsxPath(filePath)) throw new Error(tAi('xlsx.notXlsx'));
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new Error(tAi('tools.notRegularFile'));
  if (stat.size > XLSX_MAX_FILE_BYTES) throw new Error(tAi('tools.fileTooLarge', { size: stat.size, max: XLSX_MAX_FILE_BYTES }));
  return fs.readFile(filePath);
}

async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs' load signature is typed against an older Buffer definition.
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook;
}

/** Normalizes an exceljs cell value to a JSON-friendly scalar (formulas show as "=..."). */
export function normalizeCellValue(value: ExcelJS.CellValue): XlsxCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('formula' in value && typeof value.formula === 'string') return `=${value.formula}`;
    if ('sharedFormula' in value && typeof value.sharedFormula === 'string') return `=${value.sharedFormula}`;
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return String(value.error);
  }
  return String(value);
}

function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function sheetGrid(sheet: ExcelJS.Worksheet): Map<string, XlsxCellValue> {
  const grid = new Map<string, XlsxCellValue>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = normalizeCellValue(cell.value);
      if (value !== null && value !== '') grid.set(`${columnLetter(colNumber)}${rowNumber}`, value);
    });
  });
  return grid;
}

function summarizeSheet(sheet: ExcelJS.Worksheet, maxRows: number): XlsxSheetSummary {
  const rowCount = sheet.actualRowCount > 0 ? sheet.rowCount : 0;
  const columnCount = sheet.actualColumnCount > 0 ? sheet.columnCount : 0;
  const width = Math.min(columnCount, XLSX_MAX_PREVIEW_COLUMNS);
  const readRow = (rowNumber: number): XlsxCellValue[] => {
    const row = sheet.getRow(rowNumber);
    return Array.from({ length: width }, (_, i) => normalizeCellValue(row.getCell(i + 1).value));
  };
  const rows: XlsxSheetSummary['rows'] = [];
  for (let r = 2; r <= rowCount && rows.length < maxRows; r += 1) rows.push({ row: r, values: readRow(r) });
  return {
    name: sheet.name,
    usedRange: rowCount && columnCount ? `A1:${columnLetter(columnCount)}${rowCount}` : null,
    rowCount,
    columnCount,
    headers: rowCount ? readRow(1) : [],
    rows,
  };
}

export async function inspectXlsxFile(filePath: string, maxRows = XLSX_DEFAULT_PREVIEW_ROWS): Promise<XlsxInspection> {
  const bytes = await readXlsxBytes(filePath);
  const workbook = await loadWorkbook(bytes);
  const limit = Math.max(0, Math.min(XLSX_MAX_PREVIEW_ROWS, Math.floor(maxRows)));
  return {
    fileName: path.basename(filePath),
    fingerprint: fingerprintBytes(bytes),
    sheets: workbook.worksheets.map((sheet) => summarizeSheet(sheet, limit)),
  };
}

function requireSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) {
    throw new Error(tAi('xlsx.sheetMissing', { name, available: workbook.worksheets.map((item) => item.name).join(', ') }));
  }
  return sheet;
}

function applyOp(workbook: ExcelJS.Workbook, op: XlsxSheetOp): string | null {
  const sheet = requireSheet(workbook, op.sheet);
  switch (op.op) {
    case 'setCell': {
      const cell = sheet.getCell(op.ref);
      cell.value = op.formula !== undefined ? { formula: op.formula.replace(/^=/, '') } : (op.value ?? null);
      return null;
    }
    case 'insertRows':
      sheet.spliceRows(op.at, 0, ...op.rows);
      return `${op.sheet}: +${op.rows.length} row(s) at ${op.at}`;
    case 'deleteRows':
      sheet.spliceRows(op.at, op.count);
      return `${op.sheet}: -${op.count} row(s) from ${op.at}`;
    case 'setStyle': {
      const cell = sheet.getCell(op.ref);
      if (op.bold !== undefined || op.italic !== undefined) {
        cell.font = { ...cell.font, ...(op.bold !== undefined ? { bold: op.bold } : {}), ...(op.italic !== undefined ? { italic: op.italic } : {}) };
      }
      if (op.fillColor) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${op.fillColor.replace('#', '').toUpperCase()}` } };
      }
      if (op.numFmt) cell.numFmt = op.numFmt;
      return `${op.sheet}!${op.ref}: style`;
    }
  }
}

export function diffWorkbookGrids(
  before: Map<string, Map<string, XlsxCellValue>>,
  after: Map<string, Map<string, XlsxCellValue>>,
): { changes: XlsxCellChange[]; truncated: boolean } {
  const changes: XlsxCellChange[] = [];
  let truncated = false;
  const sheets = new Set([...before.keys(), ...after.keys()]);
  for (const sheet of sheets) {
    const a = before.get(sheet) ?? new Map();
    const b = after.get(sheet) ?? new Map();
    const refs = [...new Set([...a.keys(), ...b.keys()])].sort(compareRefs);
    for (const ref of refs) {
      const prev = a.get(ref) ?? null;
      const next = b.get(ref) ?? null;
      if (prev === next) continue;
      if (changes.length >= XLSX_MAX_DIFF_ENTRIES) { truncated = true; break; }
      changes.push({ sheet, ref, before: prev, after: next });
    }
  }
  return { changes, truncated };
}

function compareRefs(left: string, right: string): number {
  const parse = (ref: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return { col: match[1], row: Number(match[2]) };
  };
  const a = parse(left);
  const b = parse(right);
  return a.row - b.row || a.col.length - b.col.length || a.col.localeCompare(b.col);
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(tAi('xlsx.timeout'))), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

/** Builds the edited workbook in memory and returns a proposal; nothing is written. */
export async function planXlsxEdit(
  filePath: string,
  expectedFingerprint: string,
  rawOps: unknown,
  timeoutMs = XLSX_OPERATION_TIMEOUT_MS,
): Promise<XlsxProposal> {
  const ops = xlsxSheetOpsSchema.parse(rawOps);
  return withTimeout((async () => {
    const bytes = await readXlsxBytes(filePath);
    const baseFingerprint = fingerprintBytes(bytes);
    if (baseFingerprint !== expectedFingerprint) throw new Error(tAi('xlsx.fingerprintStale'));
    const original = await loadWorkbook(bytes);
    const workbook = await loadWorkbook(bytes);
    const structural: string[] = [];
    for (const op of ops) {
      const note = applyOp(workbook, op);
      if (note) structural.push(note);
    }
    const gridOf = (book: ExcelJS.Workbook) => new Map(book.worksheets.map((sheet) => [sheet.name, sheetGrid(sheet)]));
    const { changes, truncated } = diffWorkbookGrids(gridOf(original), gridOf(workbook));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      id: randomUUID(),
      filePath,
      baseFingerprint,
      nextFingerprint: fingerprintBytes(buffer),
      buffer,
      diff: { changes, truncated, structural },
      ops,
    };
  })(), timeoutMs);
}

function backupStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Writes an accepted proposal: re-checks the fingerprint, backs the original up
 * under `<backupRoot>/.easyview/ai-backups/<timestamp>/`, then writes atomically.
 */
export async function commitXlsxProposal(
  proposal: XlsxProposal,
  backupRoot: string,
  now: Date = new Date(),
): Promise<XlsxCommitRecord> {
  const current = await readXlsxBytes(proposal.filePath);
  if (fingerprintBytes(current) !== proposal.baseFingerprint) throw new Error(tAi('xlsx.fingerprintStale'));
  const backupDir = path.join(backupRoot, '.easyview', 'ai-backups', `${backupStamp(now)}-${proposal.id.slice(0, 8)}`);
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, path.basename(proposal.filePath));
  await fs.writeFile(backupPath, current, { flag: 'wx' });
  await writeFileAtomically(proposal.filePath, proposal.buffer);
  return { filePath: proposal.filePath, backupPath, writtenFingerprint: proposal.nextFingerprint };
}

/** Restores the backup of a commit unless the file was changed after that commit. */
export async function undoXlsxCommit(record: XlsxCommitRecord): Promise<void> {
  const current = await readXlsxBytes(record.filePath);
  if (fingerprintBytes(current) !== record.writtenFingerprint) throw new Error(tAi('xlsx.undoStale'));
  const backup = await fs.readFile(record.backupPath);
  await writeFileAtomically(record.filePath, backup);
}
