import ExcelJS from 'exceljs';
import type { SpreadsheetSheetSnapshot } from '@easyview/contracts';

export const SPREADSHEET_SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 64;
const MAX_CELLS = 300_000;

export const isSpreadsheetSnapshotPath = (file: string): boolean => /\.(xlsx|xlsm)$/i.test(file);

/** Reads every worksheet's displayed cell texts. Throws when the workbook is unreadable or too large to compare. */
export async function readSpreadsheetSnapshot(bytes: Buffer): Promise<SpreadsheetSheetSnapshot[]> {
  if (bytes.byteLength > SPREADSHEET_SNAPSHOT_MAX_BYTES) throw new Error('Workbook is too large to compare.');
  const workbook = new ExcelJS.Workbook();
  // exceljs' load signature is typed against an older Buffer definition.
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  if (workbook.worksheets.length > MAX_SHEETS) throw new Error('Workbook has too many worksheets to compare.');
  const sheets: SpreadsheetSheetSnapshot[] = [];
  let cells = 0;
  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        const text = cellText(cell.value);
        if (!text) return;
        if (++cells > MAX_CELLS) throw new Error('Workbook has too many cells to compare.');
        values[colNumber - 1] = text;
      });
      if (values.length) rows[rowNumber - 1] = Array.from(values, value => value ?? '');
    });
    sheets.push({ name: worksheet.name, rows: Array.from(rows, row => row ?? []) });
  });
  return sheets;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return dateText(value);
  if (typeof value === 'object') {
    if ('formula' in value && typeof value.formula === 'string') return `=${value.formula}`;
    if ('sharedFormula' in value && typeof value.sharedFormula === 'string') return `=${value.sharedFormula}`;
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if ('hyperlink' in value && 'text' in value) return typeof value.text === 'string' ? value.text : cellText(value.text as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return String(value.error);
  }
  return String(value);
}

/** Excel stores dates without a zone; exceljs exposes them as UTC. */
function dateText(date: Date): string {
  const iso = date.toISOString();
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return iso.replace('T', ' ').replace(/(:\d{2})\.\d{3}Z$/, '$1');
}
