/**
 * Excel (.xlsx) editing core for AI Agent mode.
 *
 * Every edit is staged in memory first: callers get a cell-level diff and a
 * proposal; only `commitXlsxProposal` touches disk, after re-checking the
 * fingerprint, keeping the original restorable, and writing atomically. `undoXlsxCommit`
 * restores the backup as long as the file was not changed after the commit.
 */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { writeFileAtomically } from '../filesystem/file-write';
import { readOfficeBackup, type OfficeBackupRef, type OfficeBackupStore } from './office-backups';
import { tAi } from './ai.i18n';

export const XLSX_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Max ops in one apply_sheet_ops call. Prefer range ops for big batches: they are far shorter for the model to emit. */
export const XLSX_MAX_OPS = 30_000;
/** Max cells a single call may touch through range ops (setRange / transformRange / replaceWhere). */
export const XLSX_MAX_RANGE_CELLS = 500_000;
export const XLSX_MAX_DIFF_ENTRIES = 1000;
export const XLSX_DEFAULT_PREVIEW_ROWS = 20;
export const XLSX_MAX_PREVIEW_ROWS = 200;
export const XLSX_MAX_PREVIEW_COLUMNS = 50;
export const XLSX_OPERATION_TIMEOUT_MS = 120_000;

const CELL_REF = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
const RANGE_REF = /^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/;
const COLUMN_REF = /^[A-Z]{1,3}$/;
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
    op: z.literal('setRange'),
    sheet: sheetName,
    range: z.string().regex(RANGE_REF),
    /** One value copied into every cell of the range. */
    value: cellValueSchema.optional(),
    /** Row-major grid with exactly the range's shape; each cell gets its own value. */
    values: z.array(z.array(cellValueSchema)).min(1).optional(),
    /** May use {row} / {col} placeholders, e.g. "=B{row}*C{row}". */
    formula: z.string().min(1).max(8192).optional(),
  })
    .refine((op) => [op.value, op.values, op.formula].filter((item) => item !== undefined).length === 1, { message: 'setRange needs exactly one of value, values or formula' })
    .refine((op) => {
      if (op.values === undefined) return true;
      const r = parseRange(op.range);
      return op.values.length === r.bottom - r.top + 1 && op.values.every((line) => line.length === r.right - r.left + 1);
    }, { message: 'setRange values must be a row-major grid with exactly the same rows and columns as range' })
    .refine((op) => !(typeof op.value === 'string' && /[\n\t]/.test(op.value) && parseRange(op.range).cells > 1), {
      message: 'setRange value is copied into every cell; to fill different data per cell use values (2D grid), and to append rows use insertRows',
    }),
  z.object({
    op: z.literal('transformRange'),
    sheet: sheetName,
    range: z.string().regex(RANGE_REF),
    transform: z.enum(['multiply', 'add', 'round', 'replaceText', 'prefix', 'suffix', 'clear']),
    number: z.number().finite().optional(),
    digits: z.number().int().min(0).max(10).optional(),
    find: z.string().min(1).max(1000).optional(),
    text: z.string().max(1000).optional(),
  }).refine((op) => {
    if (op.transform === 'multiply' || op.transform === 'add') return op.number !== undefined;
    if (op.transform === 'replaceText') return op.find !== undefined && op.text !== undefined;
    if (op.transform === 'prefix' || op.transform === 'suffix') return op.text !== undefined;
    return true;
  }, { message: 'transformRange is missing the argument its transform needs' }),
  z.object({
    op: z.literal('replaceWhere'),
    sheet: sheetName,
    matchColumn: z.string().regex(COLUMN_REF),
    equals: cellValueSchema,
    setColumn: z.string().regex(COLUMN_REF),
    value: cellValueSchema.optional(),
    formula: z.string().min(1).max(8192).optional(),
    fromRow: z.number().int().min(1).max(1_048_576).optional(),
    toRow: z.number().int().min(1).max(1_048_576).optional(),
  }).refine((op) => (op.value === undefined) !== (op.formula === undefined), { message: 'replaceWhere needs exactly one of value or formula' }),
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
  /** Number of changed cells, including those beyond the `changes` cap. */
  total: number;
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
  backup: OfficeBackupRef;
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

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function parseRange(range: string): { top: number; left: number; bottom: number; right: number; cells: number } {
  const [start, end = start] = range.split(':');
  const parse = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; return { col: columnNumber(m[1]), row: Number(m[2]) }; };
  const a = parse(start); const b = parse(end);
  const top = Math.min(a.row, b.row); const bottom = Math.max(a.row, b.row);
  const left = Math.min(a.col, b.col); const right = Math.max(a.col, b.col);
  return { top, left, bottom, right, cells: (bottom - top + 1) * (right - left + 1) };
}

function fillFormula(formula: string, row: number, col: number): ExcelJS.CellValue {
  return { formula: formula.replace(/^=/, '').replace(/\{row\}/g, String(row)).replace(/\{col\}/g, columnLetter(col)) };
}

function transformCell(cell: ExcelJS.Cell, op: Extract<XlsxSheetOp, { op: 'transformRange' }>): void {
  const value = cell.value;
  switch (op.transform) {
    case 'clear': cell.value = null; return;
    case 'multiply': if (typeof value === 'number') cell.value = value * op.number!; return;
    case 'add': if (typeof value === 'number') cell.value = value + op.number!; return;
    case 'round': if (typeof value === 'number') { const f = 10 ** (op.digits ?? 0); cell.value = Math.round(value * f) / f; } return;
    case 'replaceText': if (typeof value === 'string') cell.value = value.split(op.find!).join(op.text!); return;
    case 'prefix': if (typeof value === 'string' || typeof value === 'number') cell.value = `${op.text}${value}`; return;
    case 'suffix': if (typeof value === 'string' || typeof value === 'number') cell.value = `${value}${op.text}`; return;
  }
}

/** Cells a range op will touch; used to enforce XLSX_MAX_RANGE_CELLS before any work. */
export function rangeOpCells(op: XlsxSheetOp): number {
  if (op.op === 'setRange' || op.op === 'transformRange') return parseRange(op.range).cells;
  // replaceWhere is bounded by the sheet's own row count, so it needs no up-front cap.
  return 0;
}

function applyOp(workbook: ExcelJS.Workbook, op: XlsxSheetOp): string | null {
  const sheet = requireSheet(workbook, op.sheet);
  switch (op.op) {
    case 'setRange': {
      const r = parseRange(op.range);
      for (let row = r.top; row <= r.bottom; row += 1) {
        const line = sheet.getRow(row);
        for (let col = r.left; col <= r.right; col += 1) {
          line.getCell(col).value = op.formula !== undefined
            ? fillFormula(op.formula, row, col)
            : op.values !== undefined ? op.values[row - r.top][col - r.left] : (op.value ?? null);
        }
      }
      return null;
    }
    case 'transformRange': {
      const r = parseRange(op.range);
      const bottom = Math.min(r.bottom, sheet.rowCount);
      for (let row = r.top; row <= bottom; row += 1) {
        const line = sheet.getRow(row);
        for (let col = r.left; col <= r.right; col += 1) transformCell(line.getCell(col), op);
      }
      return null;
    }
    case 'replaceWhere': {
      const match = columnNumber(op.matchColumn); const target = columnNumber(op.setColumn);
      const bottom = Math.min(op.toRow ?? sheet.rowCount, sheet.rowCount);
      for (let row = op.fromRow ?? 2; row <= bottom; row += 1) {
        const line = sheet.getRow(row);
        if (normalizeCellValue(line.getCell(match).value) !== op.equals) continue;
        line.getCell(target).value = op.formula !== undefined ? fillFormula(op.formula, row, target) : (op.value ?? null);
      }
      return null;
    }
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
): { changes: XlsxCellChange[]; total: number; truncated: boolean } {
  const changes: XlsxCellChange[] = [];
  let total = 0;
  const sheets = new Set([...before.keys(), ...after.keys()]);
  for (const sheet of sheets) {
    const a = before.get(sheet) ?? new Map<string, XlsxCellValue>();
    const b = after.get(sheet) ?? new Map<string, XlsxCellValue>();
    // Collect changed refs first (linear), then sort only those by a precomputed numeric key.
    const changed: Array<{ key: number; ref: string; before: XlsxCellValue; after: XlsxCellValue }> = [];
    const visit = (ref: string) => {
      const prev = a.get(ref) ?? null;
      const next = b.get(ref) ?? null;
      if (prev !== next) changed.push({ key: refSortKey(ref), ref, before: prev, after: next });
    };
    for (const ref of a.keys()) visit(ref);
    for (const ref of b.keys()) if (!a.has(ref)) visit(ref);
    total += changed.length;
    if (changes.length >= XLSX_MAX_DIFF_ENTRIES) continue;
    changed.sort((left, right) => left.key - right.key);
    for (const item of changed) {
      if (changes.length >= XLSX_MAX_DIFF_ENTRIES) break;
      changes.push({ sheet, ref: item.ref, before: item.before, after: item.after });
    }
  }
  return { changes, total, truncated: total > changes.length };
}

/** Row-major sort key for an A1 reference (rows up to 2^20, columns up to 16384). */
function refSortKey(ref: string): number {
  const match = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return Number(match[2]) * 20_000 + columnNumber(match[1]);
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
  const rangeCells = ops.reduce((sum, op) => sum + rangeOpCells(op), 0);
  if (rangeCells > XLSX_MAX_RANGE_CELLS) throw new Error(tAi('xlsx.rangeTooLarge', { cells: rangeCells, max: XLSX_MAX_RANGE_CELLS }));
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
    const { changes, total, truncated } = diffWorkbookGrids(gridOf(original), gridOf(workbook));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      id: randomUUID(),
      filePath,
      baseFingerprint,
      nextFingerprint: fingerprintBytes(buffer),
      buffer,
      diff: { changes, total, truncated, structural },
      ops,
    };
  })(), timeoutMs);
}

/**
 * Writes an accepted proposal: re-checks the fingerprint, keeps the original
 * restorable through `backups` (Git snapshot or app-data copy), then writes atomically.
 */
export async function commitXlsxProposal(
  proposal: XlsxProposal,
  backups: OfficeBackupStore,
  now: Date = new Date(),
): Promise<XlsxCommitRecord> {
  const current = await readXlsxBytes(proposal.filePath);
  if (fingerprintBytes(current) !== proposal.baseFingerprint) throw new Error(tAi('xlsx.fingerprintStale'));
  const backup = await backups.save(proposal.filePath, current, proposal.id, now);
  await writeFileAtomically(proposal.filePath, proposal.buffer);
  return { filePath: proposal.filePath, backup, writtenFingerprint: proposal.nextFingerprint };
}

/** Restores the backup of a commit unless the file was changed after that commit. */
export async function undoXlsxCommit(record: XlsxCommitRecord): Promise<void> {
  const current = await readXlsxBytes(record.filePath);
  if (fingerprintBytes(current) !== record.writtenFingerprint) throw new Error(tAi('xlsx.undoStale'));
  await writeFileAtomically(record.filePath, await readOfficeBackup(record.backup));
}
