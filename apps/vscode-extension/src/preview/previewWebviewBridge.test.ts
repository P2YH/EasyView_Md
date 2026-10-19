// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Webview side of the VS Code preview toolbar: the host object PreviewShell receives.
 * Save → `writeBytes` postMessage and its reply; theme button → `writePreviewFileTheme`;
 * the product-theme command → `productThemeChanged` updates the document theme.
 */
const captured = vi.hoisted(() => ({ props: undefined as any, posted: [] as any[] }));
vi.mock('@easyview/preview-ui', () => ({ PreviewShell: (props: unknown) => { captured.props = props; return null; } }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: (element: { props: unknown }) => { captured.props = element.props; } }) }));

const descriptor = { sessionId: 's1', relativePath: 'book.xlsx', fileName: 'book.xlsx', route: 'spreadsheet', size: 10, mtimeMs: 1, mimeType: 'x', contentUrl: 'u' };

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  (window as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => captured.posted.push(m), getState: () => null, setState: () => undefined });
  (window as any).__EASYVIEW_PREVIEW_BOOTSTRAP__ = { type: 'init', descriptor, assets: { fileViewerAssetBaseUrl: '/' }, productTheme: 'gray', fileTheme: 'dark' };
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
  await import('./previewWebview');
});

const reply = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));

describe('VS Code preview webview host', () => {
  it('Save: posts the bytes base64-encoded and resolves with the extension reply, updating the descriptor', async () => {
    const { host } = captured.props;
    const pending = host.writeBytes('s1', new Uint8Array([80, 75, 3, 4]));
    const sent = captured.posted.at(-1);
    expect(sent).toMatchObject({ type: 'writeBytes', sessionId: 's1', encoding: 'base64', bytes: 'UEsDBA==' });
    const listener = vi.fn(); host.subscribe(listener);
    reply({ type: 'writeBytesResult', id: 'other', ok: true, value: { size: 1, mtimeMs: 1 } }); // ignored
    reply({ type: 'writeBytesResult', id: sent.id, ok: true, value: { size: 4, mtimeMs: 99 } });
    await expect(pending).resolves.toEqual({ size: 4, mtimeMs: 99 });
    expect(host.getState().descriptor).toMatchObject({ size: 4, mtimeMs: 99 });
    expect(listener).toHaveBeenCalled();
  });

  it('Save: surfaces the extension error message', async () => {
    const pending = captured.props.host.writeBytes('s1', new Uint8Array([1]));
    reply({ type: 'writeBytesResult', id: captured.posted.at(-1).id, ok: false, message: 'disk full' });
    await expect(pending).rejects.toThrow('disk full');
  });

  it('Theme: reads the bootstrap themes and persists a per-file choice through the extension', () => {
    const storage = captured.props.assets.themeStorage;
    expect(storage.getProductTheme()).toBe('gray');
    expect(storage.readFileTheme('book.xlsx')).toBe('dark');
    storage.writeFileTheme('book.xlsx', 'light');
    expect(captured.posted.at(-1)).toEqual({ type: 'writePreviewFileTheme', relativePath: 'book.xlsx', mode: 'light' });
    expect(storage.readFileTheme('book.xlsx')).toBe('light');
  });

  it('Theme: a product-theme change from the extension retheme the document and notifies viewers', () => {
    const seen = vi.fn(); window.addEventListener('easyview:productThemeChanged', (e) => seen((e as CustomEvent).detail));
    reply({ type: 'productThemeChanged', mode: 'dark' });
    expect(document.body.dataset.easyviewTheme).toBe('dark');
    expect(captured.props.assets.themeStorage.getProductTheme()).toBe('dark');
    expect(seen).toHaveBeenCalledWith({ mode: 'dark', isDark: true });
    reply({ type: 'productThemeChanged', mode: 'neon' });
    expect(document.body.dataset.easyviewTheme).toBe('dark');
  });
});
