import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { LazyWorkbook } from '../src/spreadsheet/lazyWorkbook';
async function fixture() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('First').getCell('A1').value = 'edit me';
  const sheet = book.addWorksheet('Unloaded & formatted');
  sheet.getCell('A1').value = 42;
  sheet.getCell('B1').value = { formula: 'A1*2', result: 84 };
  sheet.getCell('A1').font = { name: 'Arial', bold: true, color: { argb: 'FFFF0000' } };
  sheet.getCell('A1').numFmt = '0.000';
  sheet.mergeCells('C3:D4'); sheet.getCell('C3').value = 'merged';
  sheet.getColumn(1).width = 33; sheet.getRow(1).height = 28;
  sheet.getCell('E1').dataValidation = { type: 'list', formulae: ['"a,b"'] };
  const third = book.addWorksheet('Third'); third.getCell('A1').value = 'original';
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3, 4]));
  zip.file('customXml/item1.xml', '<custom>keep</custom>');
  return zip.generateAsync({ type: 'arraybuffer' });
}
describe('lazy workbook archive', () => {
  it('opens only the selected sheet, loads on demand and reuses decoded sheets', async () => {
    const lazy = await LazyWorkbook.open(await fixture());
    expect(lazy.metrics.decodedSheets).toBe(0);
    expect(lazy.sheets.map(sheet => sheet.name)).toEqual(['First', 'Unloaded & formatted', 'Third']);
    expect((await lazy.load(0)).rows?.[0].cells?.[0].text).toBe('edit me');
    expect(lazy.metrics.decodedSheets).toBe(1);
    await lazy.load(0); expect(lazy.metrics.decodedSheets).toBe(1);
    expect((await lazy.load(1)).rows?.[0].cells?.[1].text).toBe('84');
    expect(lazy.metrics.decodedSheets).toBe(2);
  });
  it('preserves all untouched ZIP entry bytes, even loaded sheets, formula/style/merges/VBA', async () => {
    const bytes = await fixture(), original = await JSZip.loadAsync(bytes);
    const lazy = await LazyWorkbook.open(bytes);
    const first = await lazy.load(0); await lazy.load(2);
    first.rows![0].cells![0].text = 'changed';
    const saved = await lazy.save([{ index: 0, data: first }, { index: 2, data: Object.assign(await lazy.load(2), { freeze: 'A1', validations: [], autofilter: {} }) }]);
    const zip = await JSZip.loadAsync(saved);
    for (const [path, entry] of Object.entries(original.files)) {
      if (entry.dir || ['xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml'].includes(path)) continue;
      expect(await zip.file(path)!.async('uint8array'), path).toEqual(await entry.async('uint8array'));
    }
    const book = new ExcelJS.Workbook(); await book.xlsx.load(saved.buffer as ArrayBuffer);
    expect(book.worksheets[0].getCell('A1').value).toBe('changed');
    const other = book.worksheets[1];
    expect(other.getCell('B1').value).toEqual({ formula: 'A1*2', result: 84 });
    expect(other.getCell('A1').font?.bold).toBe(true);
    expect(other.getCell('A1').numFmt).toBe('0.000');
    expect(other.model.merges).toContain('C3:D4');
  });
  it('retains unchanged native cells in edited sheets and saves repeatably without changing the baseline', async () => {
    const lazy = await LazyWorkbook.open(await fixture());
    const data = await lazy.load(1);
    data.rows![0].cells![0].text = '100';
    data.styles!.push({ bgcolor: '#00ff00', font: { bold: true } });
    data.rows![0].cells![0].style = data.styles!.length - 1;
    const bytes = await lazy.save([{ index: 1, data }]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(book.worksheets[1].getCell('B1').value).toEqual({ formula: 'A1*2', result: 84 });
    expect(book.worksheets[1].getCell('A1').numFmt).toBe('0.000');
    expect(book.worksheets[1].getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FF00FF00' } });
    const reverted = await lazy.save([{ index: 1, data: await lazy.load(1) }]);
    const restored = new ExcelJS.Workbook(); await restored.xlsx.load(reverted.buffer as ArrayBuffer);
    expect(restored.worksheets[1].getCell('A1').value).toBe(42);
  });
  it('does not inflate an invalid unloaded sheet; budget rejects it only when requested', async () => {
    const zip = await JSZip.loadAsync(await fixture());
    zip.file('xl/worksheets/sheet3.xml', '<worksheet><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>');
    const lazy = await LazyWorkbook.open(await zip.generateAsync({ type: 'arraybuffer' }));
    await lazy.load(0); expect(lazy.metrics.decodedSheets).toBe(1);
    await expect(lazy.load(2)).rejects.toThrow(/容量|limit/);
  });
  it('honors the active sheet and preserves global style/string indexes across edits in two sheets', async () => {
    const zip = await JSZip.loadAsync(await fixture());
    zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('<sheets>', '<bookViews><workbookView activeTab="1"/></bookViews><sheets>'));
    const lazy = await LazyWorkbook.open(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(lazy.active).toBe(1);
    const first = await lazy.load(0), second = await lazy.load(1);
    first.rows![0].cells![0].text = 'first edit'; second.rows![0].cells![0].text = 'second edit';
    first.styles!.push({ color: '#0000ff' }); first.rows![0].cells![0].style = first.styles!.length - 1;
    const saved = await lazy.save([{ index: 0, data: first }, { index: 1, data: second }]);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(saved.buffer as ArrayBuffer);
    expect(workbook.worksheets[0].getCell('A1').text).toBe('first edit');
    expect(workbook.worksheets[1].getCell('A1').text).toBe('second edit');
    expect(workbook.worksheets[1].getCell('A1').font?.color?.argb).toBe('FFFF0000');
    expect(workbook.worksheets[1].getCell('A1').numFmt).toBe('0.000');
    expect(workbook.worksheets[2].getCell('A1').text).toBe('original');
  });
  it('adds shared-string relationships for an originally inline-string workbook', async () => {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Inline').getCell('A1').value = 'inline';
    const bytes = new Uint8Array(await book.xlsx.writeBuffer({ useSharedStrings: false })).slice().buffer;
    const lazy = await LazyWorkbook.open(bytes), sheet = await lazy.load(0);
    sheet.rows![0].cells![0].text = 'edited';
    const saved = await lazy.save([{ index: 0, data: sheet }]);
    const result = new ExcelJS.Workbook(); await result.xlsx.load(saved.buffer as ArrayBuffer);
    expect(result.worksheets[0].getCell('A1').text).toBe('edited');
  });

});
