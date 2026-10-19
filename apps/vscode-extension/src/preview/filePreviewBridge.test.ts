import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { previewFileThemeStorageKey } from '@easyview/contracts';
import { LazyWorkbook } from '../../../../packages/preview-ui/src/spreadsheet/lazyWorkbook';

/**
 * Extension side of the preview toolbar: the webview → extension message bridge.
 * Save (xlsx/docx) arrives as `writeBytes`; the theme button as `writePreviewFileTheme`.
 * Bytes come from the real x-spreadsheet serialiser (LazyWorkbook) and are re-read with ExcelJS.
 */
const disk = new Map<string, Uint8Array>();
const mocks = vi.hoisted(() => ({ disk: undefined as unknown as Map<string, Uint8Array> }));

vi.mock('vscode', () => {
  const uri = (fsPath: string) => ({ scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}`, with: () => uri(fsPath) });
  return {
    Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join('/')) },
    window: { registerCustomEditorProvider: vi.fn() },
    workspace: {
      getWorkspaceFolder: () => ({ uri: uri('/ws') }),
      asRelativePath: (u: { fsPath: string }) => u.fsPath.replace('/ws/', ''),
      fs: {
        stat: async (u: { fsPath: string }) => { const b = mocks.disk.get(u.fsPath); if (!b) throw new Error('ENOENT'); return { size: b.byteLength, mtime: 1234 }; },
        readFile: async (u: { fsPath: string }) => mocks.disk.get(u.fsPath)!,
        writeFile: async (u: { fsPath: string }, bytes: Uint8Array) => { mocks.disk.set(u.fsPath, bytes); },
      },
    },
  };
});

import * as vscode from 'vscode';
import { FilePreviewProvider } from './filePreviewProvider';

function fakePanel() {
  let onMessage: ((message: unknown) => Promise<void>) | undefined;
  const posted: Array<Record<string, unknown>> = [];
  const panel = {
    visible: true,
    webview: {
      options: {}, html: '', cspSource: 'vscode-resource:',
      asWebviewUri: (u: { toString(): string }) => { const web = { toString: () => `https://webview/${u.toString()}`, with: () => web }; return web; },
      postMessage: async (message: Record<string, unknown>) => { posted.push(message); return true; },
      onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => { onMessage = handler; return { dispose() {} }; },
    },
    onDidDispose: () => ({ dispose() {} }),
  };
  return { panel, posted, send: (message: unknown) => onMessage!(message) };
}

const workspaceState = new Map<string, unknown>();
const context = {
  extensionUri: (vscode.Uri as any).file('/ext'),
  extension: { packageJSON: { version: 'test' } },
  globalState: { get: () => undefined, update: async () => undefined },
  workspaceState: { get: (key: string) => workspaceState.get(key), update: async (key: string, value: unknown) => { workspaceState.set(key, value); } },
};

async function open(file: string) {
  const provider = new FilePreviewProvider(context as any);
  const { panel, posted, send } = fakePanel();
  const uri = (vscode.Uri as any).file(`/ws/${file}`);
  await provider.resolveCustomEditor(await provider.openCustomDocument(uri, {} as any, {} as any), panel as any, {} as any);
  return { panel, posted, send };
}

async function seedBook(): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Data');
  for (let r = 1; r <= 5; r += 1) for (let c = 1; c <= 4; c += 1) sheet.getCell(r, c).value = r * 10 + c;
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  disk.set('/ws/book.xlsx', bytes);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

beforeEach(() => { mocks.disk = disk; disk.clear(); workspaceState.clear(); });

describe('VS Code preview toolbar bridge', () => {
  it('Save: toolbar edits serialised by the webview reach disk intact (bold, fill, border, merge, freeze, filter)', async () => {
    const original = await seedBook();
    const lazy = await LazyWorkbook.open(original);
    const data = await lazy.load(0);
    data.styles = [{ font: { bold: true }, bgcolor: '#ffc000', border: { top: ['thin', '#000000'], right: ['thin', '#000000'], bottom: ['thin', '#000000'], left: ['thin', '#000000'] } }];
    data.rows![1].cells![1].style = 0; // B2
    data.merges = ['B4:C4']; data.freeze = 'C3'; data.autofilter = { ref: 'A1:D5', filters: [] };
    const bytes = await lazy.save([{ index: 0, data }]);

    const { send, posted } = await open('book.xlsx');
    await send({ type: 'writeBytes', id: 'w1', encoding: 'base64', bytes: Buffer.from(bytes).toString('base64') });
    expect(posted.at(-1)).toMatchObject({ type: 'writeBytesResult', id: 'w1', ok: true, value: { size: bytes.byteLength, mtimeMs: 1234 } });

    const book = new ExcelJS.Workbook(); await book.xlsx.load(disk.get('/ws/book.xlsx')! as unknown as ExcelJS.Buffer);
    const ws = book.worksheets[0]; const b2 = ws.getCell('B2');
    expect(b2.font?.bold).toBe(true);
    expect((b2.fill as ExcelJS.FillPattern).fgColor?.argb).toMatch(/FFC000/i);
    expect(b2.border?.top?.style).toBe('thin'); expect(b2.border?.left?.style).toBe('thin');
    expect((ws.model as { merges?: string[] }).merges).toContain('B4:C4');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 2 });
    expect(ws.autoFilter).toBe('A1:D5');
  });

  it('Save: rejects empty payloads and read-only routes without touching disk', async () => {
    await seedBook(); const before = disk.get('/ws/book.xlsx');
    const xlsx = await open('book.xlsx');
    await xlsx.send({ type: 'writeBytes', id: 'w2', encoding: 'base64', bytes: '' });
    expect(xlsx.posted.at(-1)).toMatchObject({ type: 'writeBytesResult', id: 'w2', ok: false });
    expect(disk.get('/ws/book.xlsx')).toBe(before);
    disk.set('/ws/a.pdf', new Uint8Array([1, 2, 3]));
    const pdf = await open('a.pdf');
    await pdf.send({ type: 'writeBytes', id: 'w3', encoding: 'base64', bytes: Buffer.from('x').toString('base64') });
    expect(pdf.posted.at(-1)).toMatchObject({ type: 'writeBytesResult', id: 'w3', ok: false });
    expect(Array.from(disk.get('/ws/a.pdf')!)).toEqual([1, 2, 3]);
  });

  it('Theme: the per-file theme button is persisted in workspace state and restored on reopen', async () => {
    await seedBook();
    const first = await open('book.xlsx');
    expect(first.panel.webview.html).toContain('data-easyview-theme="light"');
    await first.send({ type: 'writePreviewFileTheme', relativePath: 'book.xlsx', mode: 'dark' });
    expect(workspaceState.get(previewFileThemeStorageKey('book.xlsx'))).toBe('dark');
    await first.send({ type: 'writePreviewFileTheme', relativePath: 'book.xlsx', mode: 'purple' });
    expect(workspaceState.get(previewFileThemeStorageKey('book.xlsx'))).toBe('dark');
    const reopened = await open('book.xlsx');
    expect(reopened.panel.webview.html).toMatch(/"fileTheme":\s*"dark"/);
  });
});
