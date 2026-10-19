import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { LazyWorkbook } from '../src/spreadsheet/lazyWorkbook';

async function bookWithStyledCell(): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Data');
  sheet.getCell('A1').value = 'head';
  sheet.getCell('A1').font = { bold: true };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  for (const ref of ['B2', 'C2', 'D2', 'B4', 'B5']) sheet.getCell(ref).value = ref;
  const bytes = await book.xlsx.writeBuffer();
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
}

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('x-spreadsheet toolbar edits survive save', () => {
  it('keeps font, fill, borders, alignment, wrap, number format, merges, freeze and filter', async () => {
    const lazy = await LazyWorkbook.open(await bookWithStyledCell());
    const data = await lazy.load(0);
    const styles = data.styles ?? [];
    const add = (style: object) => { styles.push(style); return styles.length - 1; };
    data.styles = styles;
    data.rows![1].cells![1].style = add({ font: { bold: true, italic: true, size: 14, name: 'Arial' }, underline: true, strike: true, color: '#c00000', bgcolor: '#bdd7ee' });
    data.rows![1].cells![2].style = add({ border: { top: ['thin', '#000'], right: ['medium', '#ff0000'], bottom: ['dashed', '#000000'], left: ['thin', '#000000'] } });
    data.rows![1].cells![3].style = add({ align: 'center', valign: 'top', textwrap: true, format: 'percent' });
    data.merges = ['B4:B5'];
    data.freeze = 'C3';
    data.autofilter = { ref: 'A1:D5', filters: [] };

    const reopened = await LazyWorkbook.open(toBuffer(await lazy.save([{ index: 0, data }])));
    const back = await reopened.load(0);
    const style = (ri: number, ci: number) => back.styles![back.rows![ri].cells![ci].style!];
    expect(style(1, 1)).toMatchObject({ font: { bold: true, italic: true, size: 14, name: 'Arial' }, underline: true, strike: true, color: '#c00000', bgcolor: '#bdd7ee' });
    expect(style(1, 2).border).toEqual({ top: ['thin', '#000000'], right: ['medium', '#ff0000'], bottom: ['dashed', '#000000'], left: ['thin', '#000000'] });
    expect(style(1, 3)).toMatchObject({ align: 'center', valign: 'top', textwrap: true, format: 'percent' });
    expect(style(0, 0)).toMatchObject({ font: { bold: true } });
    expect(back.merges).toEqual(['B4:B5']);
    expect(back.freeze).toBe('C3');
    expect(back.autofilter?.ref).toBe('A1:D5');
  });

  it('clears freeze and filter again', async () => {
    const lazy = await LazyWorkbook.open(await bookWithStyledCell());
    const data = await lazy.load(0);
    data.freeze = 'B2'; data.autofilter = { ref: 'A1:B2', filters: [] };
    const once = await LazyWorkbook.open(toBuffer(await lazy.save([{ index: 0, data }])));
    const loaded = await once.load(0);
    loaded.freeze = 'A1'; loaded.autofilter = { filters: [] };
    const back = await (await LazyWorkbook.open(toBuffer(await once.save([{ index: 0, data: loaded }])))).load(0);
    expect(back.freeze).toBeUndefined();
    expect(back.autofilter).toBeUndefined();
  });
});
