import { getLocale } from '@easyview/contracts/i18n';
import { toSameOriginWorkerUrl, revokeSameOriginWorkerUrl } from '../workers/sameOriginWorker';
import { tPreview } from '../preview.i18n';
import type { XsSheetData } from './xSpreadsheetTypes';
export interface WorkbookOverview { sheets: Array<{ name: string }>; active: number; data: XsSheetData }
export async function openSpreadsheetWorker(bytes: ArrayBuffer, workerUrl: string, signal: AbortSignal) {
  const url = await toSameOriginWorkerUrl(workerUrl, signal);
  if (signal.aborted) { revokeSameOriginWorkerUrl(url); throw signal.reason; }
  const worker = new Worker(url);
  let nextId = 0, closed = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const dispose = (reason: unknown = new Error('Spreadsheet closed')) => {
    if (closed) return; closed = true;
    worker.terminate(); revokeSameOriginWorkerUrl(url); signal.removeEventListener('abort', aborted);
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(reason); } pending.clear();
  };
  const aborted = () => dispose(signal.reason);
  signal.addEventListener('abort', aborted, { once: true });
  worker.onerror = () => dispose(new Error(tPreview('spreadsheet.libraryLoadFailed')));
  worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
    const task = pending.get(event.data.id); if (!task) return;
    pending.delete(event.data.id); clearTimeout(task.timer);
    if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.value);
  };
  const request = <T>(message: object, transfer: Transferable[] = []): Promise<T> => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Spreadsheet closed')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => dispose(new Error(tPreview('spreadsheet.parseTimeout'))), 30_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    worker.postMessage({ ...message, id, locale: getLocale() }, transfer);
  });
  try {
    const overview = await request<WorkbookOverview>({ type: 'open', bytes }, [bytes]);
    return {
      overview,
      load: (index: number) => request<XsSheetData>({ type: 'load', index }),
      save: (changes: Array<{ index: number; data: XsSheetData }>) => request<Uint8Array>({ type: 'save', changes }),
      dispose,
    };
  } catch (error) { dispose(error); throw error; }
}
