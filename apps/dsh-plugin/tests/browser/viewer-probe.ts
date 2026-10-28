/** Browser-only engineering fixture; never included in the plugin package. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DocViewer, SpreadsheetViewer, PreviewAssetsProvider, type PreviewHost, type DocumentEditorLifecycle, type DraftSnapshot } from '@easyview/preview-ui';
import { setLocale } from '@easyview/contracts/i18n';

setLocale('en');
const format = new URLSearchParams(location.search).get('format') === 'xlsx' ? 'xlsx' : 'docx';
let editor: DocumentEditorLifecycle | null = null;
let lastCapture: DraftSnapshot | null = null;
let failWrites = false;
let delayWrite: Promise<void> | null = null;
let releaseWrite: (() => void) | undefined;
const writes: string[] = [];
const descriptor = { sessionId: `probe-${format}`, fileName: `sample.${format}`, relativePath: `sample.${format}`,
  route: format === 'docx' ? 'word' as const : 'spreadsheet' as const, contentUrl: `/fixture.${format}`, size: 1, mtimeMs: 0, mimeType: 'application/octet-stream' };
const host: PreviewHost = {
  getState: () => ({ descriptor, status: 'ready', error: null }), subscribe: () => () => {},
  getSourceDiskHash: () => 'fixture-baseline',
  registerEditor(value) { editor = value; return () => { if (editor === value) editor = null; }; },
  async writeBytes(_id, bytes) {
    if (failWrites) throw new Error('injected_write_failure');
    await delayWrite;
    const copy = new Uint8Array(bytes);
    writes.push(base64(copy));
    return { size: bytes.length, mtimeMs: 1, diskHash: 'fixture-saved' };
  },
};
function base64(bytes: Uint8Array): string {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text);
}
Object.assign(window, { probe: {
  state: () => editor?.snapshot(), writes,
  async capture() { if (!editor) throw new Error('not ready'); lastCapture = await editor.capture(new AbortController().signal); return { ...lastCapture, bytes: base64(lastCapture.bytes) }; },
  async restore() { if (!editor || !lastCapture) throw new Error('no snapshot'); await editor.restore(lastCapture, new AbortController().signal); },
  failWrites(value: boolean) { failWrites = value; },
  holdWrite() { delayWrite = new Promise(resolve => { releaseWrite = resolve; }); },
  releaseWrite() { releaseWrite?.(); delayWrite = null; },
  async lease() { if (!editor) throw new Error('not ready'); const lease = await editor.acquireCommitLease(editor.snapshot().editorRevision, new AbortController().signal); return () => lease.release(); },
} });
const root = createRoot(document.getElementById('root')!);
root.render(React.createElement(PreviewAssetsProvider, {
  assets: { fileViewerAssetBaseUrl: '/assets/vendor/file-viewer/', spreadsheetWorkerUrl: '/assets/workers/spreadsheet-worker.js' },
}, React.createElement(format === 'docx' ? DocViewer : SpreadsheetViewer, { descriptor, host })));
