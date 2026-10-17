import { setLocale, type Locale } from '@easyview/contracts/i18n';
import { LazyWorkbook } from '../spreadsheet/lazyWorkbook';
import type { XsSheetData } from '../spreadsheet/xSpreadsheetTypes';

let workbook: LazyWorkbook;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; type: string; bytes: ArrayBuffer; index: number; changes: Array<{ index: number; data: XsSheetData }>; locale: Locale }>) => {
  queue = queue.then(async () => {
    const message = event.data; setLocale(message.locale);
    try {
      let value: unknown;
      if (message.type === 'open') {
        workbook = await LazyWorkbook.open(message.bytes);
        value = { sheets: workbook.sheets.map(({ name }) => ({ name })), active: workbook.active, data: await workbook.load(workbook.active) };
      } else if (message.type === 'load') value = await workbook.load(message.index);
      else if (message.type === 'save') value = await workbook.save(message.changes);
      else throw new Error('Unknown workbook operation');
      (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ id: message.id, value }, value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : []);
    } catch (error) { self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
