import { parseMsDoc, renderMsDoc } from '@file-viewer/doc';
import { normalizeLocale, setLocale } from '@easyview/contracts/i18n';
import { tPreview } from '../preview.i18n';

const locale = normalizeLocale(new URLSearchParams(self.location.search).get('locale'));
if (locale) setLocale(locale);

interface RenderRequest { id: number; bytes: ArrayBuffer; }
interface RenderResponse { id: number; ok: boolean; html?: string; css?: string; error?: string; }

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, bytes } = event.data;
  try {
    const rendered = renderMsDoc(parseMsDoc(bytes));
    const response: RenderResponse = { id, ok: true, html: rendered.html, css: rendered.css };
    self.postMessage(response);
  } catch (error) {
    const response: RenderResponse = { id, ok: false, error: error instanceof Error ? error.message : tPreview('doc.parseFailed') };
    self.postMessage(response);
  }
};
