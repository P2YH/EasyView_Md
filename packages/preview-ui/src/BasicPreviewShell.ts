import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolvePreviewRoute, type PreviewDescriptor } from '@easyview/contracts';
import { PreviewAppearanceContext } from './appearanceContext';
import {
  DocumentCollapseButton,
  DocumentThemeButton,
  DocumentToolbarExpandButton,
  useDocumentRouteTheme,
} from './viewers/DocumentRouteChrome';
import { useToolbarPinned } from './useToolbarPinned';
import { tPreview } from './preview.i18n';
import { usePreviewAssets } from './assets';

export interface BasicPreviewShellProps {
  descriptor: PreviewDescriptor;
  /** Optional leading controls (search / save / view mode) before theme. */
  documentActions?: React.ReactNode;
  /** Extra class on the root (e.g. preview-text-shell). */
  className?: string;
  children?: React.ReactNode;
}

/**
 * BasicChrome — shared top strip for lightweight preview routes (svg/html/http/
 * java-class/video/audio). Text also uses this shell with documentActions slots
 * so search/save sit on the same bar (no freestanding text-only toolbar).
 */
export function BasicPreviewShell({
  descriptor,
  documentActions,
  className,
  children,
}: BasicPreviewShellProps): React.ReactElement {
  const assets = usePreviewAssets();
  const { pinnedOpen, togglePinned } = useToolbarPinned();
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
  const collapseButton = !assets.compactToolbars
    ? React.createElement(DocumentCollapseButton, { onTogglePinned: togglePinned })
    : null;
  const viewGroup = React.createElement(
    'div',
    { role: 'group', 'aria-label': tPreview('chrome.view'), 'data-toolbar-group': 'view' },
    themeButton,
    collapseButton,
  );
  const documentGroup = documentActions
    ? React.createElement(
        'div',
        {
          role: 'group',
          'aria-label': tPreview('chrome.documentActions'),
          'data-toolbar-group': 'document',
        },
        documentActions,
      )
    : null;

  const rootClass = [
    'preview-basic-viewer',
    className,
    pinnedOpen ? 'is-toolbar-pinned' : 'is-toolbar-collapsed',
  ].filter(Boolean).join(' ');

  return React.createElement(PreviewAppearanceContext.Provider, { value: themeMode },
    React.createElement('section', {
      ref: rootRef,
      className: rootClass,
      style: { ...viewerVars, '--easyview-preview-text-color': appearance.textColor } as React.CSSProperties,
      'data-preview-theme': themeMode,
      'data-preview-chrome': 'basic',
    },
      !nativeToolbar
        ? React.createElement(
            'div',
            {
              className: 'preview-basic-toolbar',
              role: 'toolbar',
              'aria-label': tPreview('toolbar.group'),
              'aria-hidden': !pinnedOpen,
            },
            documentGroup,
            viewGroup,
          )
        : null,
      /* Expand dock is position:absolute to the viewer top; keep it early in DOM. */
      !pinnedOpen
        ? React.createElement(DocumentToolbarExpandButton, { onTogglePinned: togglePinned })
        : null,
      React.createElement('div', { className: 'preview-basic-content' }, children),
      pinnedOpen && nativeToolbar && nativeChrome
        ? createPortal(themeButton, nativeChrome)
        : null,
    ),
  );
}

/**
 * Routes that PreviewShell should wrap with BasicChrome.
 * Text owns BasicChrome itself (search/save slots) — do not double-wrap.
 * HEIC / .ppt are document chrome and must not appear here.
 */
export function needsBasicPreviewToolbar(descriptor: PreviewDescriptor): boolean {
  const definition = resolvePreviewRoute(descriptor.fileName);
  if (!definition || definition.chrome !== 'basic') return false;
  return definition.route !== 'text';
}
