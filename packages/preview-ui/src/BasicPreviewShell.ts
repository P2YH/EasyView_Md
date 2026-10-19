import * as React from 'react';
import { createPortal } from 'react-dom';
import type { PreviewDescriptor } from '@easyview/contracts';
import { PreviewAppearanceContext } from './appearanceContext';
import { DocumentThemeButton, useDocumentRouteTheme } from './viewers/DocumentRouteChrome';
import { useToolbarPinned } from './useToolbarPinned';
import { tPreview } from './preview.i18n';

/** Shared top strip for viewers without their own document toolbar. */
export function BasicPreviewShell({ descriptor, children }: React.PropsWithChildren<{
  descriptor: PreviewDescriptor;
}>): React.ReactElement {
  const { pinnedOpen } = useToolbarPinned();
  const { themeMode, cycleTheme, viewerVars, appearance } = useDocumentRouteTheme(descriptor.relativePath);
  const nativeToolbar = descriptor.route === 'html' || descriptor.route === 'http';
  const rootRef = React.useRef<HTMLElement | null>(null);
  const [nativeChrome, setNativeChrome] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !nativeToolbar || !pinnedOpen) {
      setNativeChrome(null);
      return;
    }
    const slot = document.createElement('div');
    slot.className = 'preview-basic-toolbar-actions';
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', tPreview('chrome.view'));
    const attach = () => {
      const toolbar = root.querySelector('.preview-tabs, .preview-http-request');
      if (toolbar && slot.parentElement !== toolbar) {
        toolbar.appendChild(slot);
        setNativeChrome(slot);
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    attach();
    return () => { observer.disconnect(); slot.remove(); };
  }, [nativeToolbar, pinnedOpen]);
  const themeButton = React.createElement(DocumentThemeButton, { themeMode, onCycleTheme: cycleTheme });
  return React.createElement(PreviewAppearanceContext.Provider, { value: themeMode },
    React.createElement('section', {
      ref: rootRef,
      className: `preview-basic-viewer ${pinnedOpen ? 'is-toolbar-pinned' : 'is-toolbar-collapsed'}`,
      style: { ...viewerVars, '--easyview-preview-text-color': appearance.textColor } as React.CSSProperties,
    },
      pinnedOpen && !nativeToolbar
        ? React.createElement('div', { className: 'preview-basic-toolbar', role: 'toolbar', 'aria-label': tPreview('toolbar.group') }, themeButton)
        : null,
      React.createElement('div', { className: 'preview-basic-content' }, children),
      pinnedOpen && nativeToolbar && nativeChrome
        ? createPortal(themeButton, nativeChrome)
        : null,
    ),
  );
}

export function needsBasicPreviewToolbar(descriptor: PreviewDescriptor): boolean {
  return ['text', 'svg', 'html', 'http', 'java-class'].includes(descriptor.route)
    || (descriptor.route === 'image' && /\.(heic|heif)$/i.test(descriptor.fileName))
    || (descriptor.route === 'powerpoint' && /\.ppt$/i.test(descriptor.fileName));
}
