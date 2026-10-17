import { tPreview } from '../preview.i18n';

/** Cache blob: Worker URLs created for cross-origin vscode-resource scripts. */
const managedBlobUrls = new Set<string>();

/**
 * VS Code / Cursor webviews run on `vscode-webview://…` while extension assets are
 * served from `https://file+.vscode-resource…`. `new Worker(assetUrl)` is blocked
 * cross-origin. Fetch the script and re-host it as a same-origin `blob:` URL.
 * Same-origin hosts (desktop http) return the original URL unchanged.
 */
export async function toSameOriginWorkerUrl(workerUrl: string, signal?: AbortSignal): Promise<string> {
  let absolute: URL;
  try {
    absolute = new URL(workerUrl, typeof location !== 'undefined' ? location.href : undefined);
  } catch {
    return workerUrl;
  }

  if (typeof location !== 'undefined' && absolute.origin === location.origin) {
    return absolute.href;
  }

  const response = await fetch(absolute.href, { signal });
  if (!response.ok) {
    throw new Error(tPreview('worker.loadFailed', { status: response.status }));
  }
  const source = await response.blob();
  // Force a JS MIME type so classic Workers accept blob: URLs from hosts that
  // omit or mis-label Content-Type (common for vscode-resource).
  const blob = source.type.includes('javascript') || source.type.includes('ecmascript')
    ? source
    : new Blob([source], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  managedBlobUrls.add(blobUrl);
  return blobUrl;
}

export function revokeSameOriginWorkerUrl(url: string | null | undefined): void {
  if (!url || !managedBlobUrls.has(url)) return;
  URL.revokeObjectURL(url);
  managedBlobUrls.delete(url);
}
