import * as React from 'react';
import { extension, h, UniversalFilePreview, loadingElement, ViewerError, usePreviewAppearance, type ViewerProps } from './shared';
import { usePreviewAssets } from '../assets';
import { tPreview } from '../preview.i18n';
import { PreviewAppearanceContext } from '../appearanceContext';
import {
  DocumentRouteShell,
  useDocumentRouteTheme,
  useToolbarPinned,
} from './DocumentRouteChrome';

export function ImageViewer({ descriptor }: ViewerProps): React.ReactElement {
  const suffix = extension(descriptor.fileName);
  const assets = usePreviewAssets();
  // HEIC needs an isolated decoder host; chrome matches other images (DocumentChrome).
  if (['.heic', '.heif'].includes(suffix)) {
    if (!assets.heicHostUrl) {
      return h(DocumentImageShell, {
        descriptor,
        body: h('div', {
          className: 'preview-viewer-message preview-viewer-unsupported',
          role: 'status',
        }, tPreview('image.heicUnsupported')),
      });
    }
    // DocumentChrome only — do not also wrap via PreviewShell BasicChrome.
    return h(DocumentImageShell, {
      descriptor,
      body: h(HeicImageViewer, { descriptor, heicHostUrl: assets.heicHostUrl }),
    });
  }
  return h(UniversalFilePreview, { descriptor, loadingLabel: tPreview('image.loadingViewer') });
}

function DocumentImageShell({
  descriptor,
  body,
}: {
  descriptor: ViewerProps['descriptor'];
  body: React.ReactNode;
}): React.ReactElement {
  const { themeMode, cycleTheme, viewerVars } = useDocumentRouteTheme(descriptor.relativePath);
  const { pinnedOpen, togglePinned } = useToolbarPinned();
  return h(PreviewAppearanceContext.Provider, { value: themeMode },
    h(DocumentRouteShell, {
      className: 'preview-image-viewer preview-heic-shell',
      themeMode,
      style: viewerVars,
      'data-ext': extension(descriptor.fileName),
      onCycleTheme: cycleTheme,
      pinnedOpen,
      onTogglePinned: togglePinned,
    }, body),
  );
}

function HeicImageViewer({ descriptor, heicHostUrl }: ViewerProps & { heicHostUrl: string }): React.ReactElement {
  const appearance = usePreviewAppearance();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const token = React.useMemo(() => crypto.randomUUID(), [descriptor.sessionId]);
  const [error, setError] = React.useState<unknown>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let disposed = false;
    const receive = (event: MessageEvent<{ type?: string; token?: string; message?: string }>) => {
      if (event.source !== frame.current?.contentWindow || event.data?.token !== token) return;
      if (event.data.type === 'heic-ready') setReady(true);
      if (event.data.type === 'heic-error') setError(new Error(event.data.message || tPreview('image.heicDecodeFailed')));
    };
    window.addEventListener('message', receive);
    const send = async () => {
      try {
        const response = await fetch(descriptor.contentUrl);
        if (!response.ok) throw new Error(tPreview('image.heicReadFailed', { status: response.status }));
        const bytes = await response.arrayBuffer();
        if (!disposed) {
          frame.current?.contentWindow?.postMessage(
            { type: 'decode-heic', token, bytes, mimeType: 'image/heic', background: appearance.background, color: appearance.textColor },
            '*',
            [bytes],
          );
        }
      } catch (reason) {
        if (!disposed) setError(reason);
      }
    };
    const iframe = frame.current;
    iframe?.addEventListener('load', send, { once: true });
    return () => {
      disposed = true;
      window.removeEventListener('message', receive);
      iframe?.removeEventListener('load', send);
    };
  }, [descriptor.contentUrl, token, appearance.background, appearance.textColor]);
  React.useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: 'set-theme', token, background: appearance.background, color: appearance.textColor },
      '*',
    );
  }, [appearance.background, appearance.textColor, token]);
  if (error) return h(ViewerError, { error });
  return h('div', { className: 'preview-heic-viewer' },
    !ready ? loadingElement(tPreview('image.heicDecoding')) : null,
    h('iframe', {
      ref: frame,
      className: 'preview-heic-frame',
      title: descriptor.fileName,
      src: heicHostUrl,
      sandbox: 'allow-scripts',
      referrerPolicy: 'no-referrer',
    }),
  );
}
