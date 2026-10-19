export const PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY = 'easyview.previewSidebarWidth';
export const PREVIEW_SIDEBAR_WIDTH_DEFAULT = 168;
export const PREVIEW_SIDEBAR_WIDTH_MIN = 120;
export const PREVIEW_SIDEBAR_WIDTH_MAX = 360;
const WIDTH_VAR = '--preview-sidebar-width';

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return PREVIEW_SIDEBAR_WIDTH_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return PREVIEW_SIDEBAR_WIDTH_DEFAULT;
    return Math.min(PREVIEW_SIDEBAR_WIDTH_MAX, Math.max(PREVIEW_SIDEBAR_WIDTH_MIN, parsed));
  } catch {
    return PREVIEW_SIDEBAR_WIDTH_DEFAULT;
  }
}

function writeStoredWidth(width: number): void {
  try {
    localStorage.setItem(PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function clampWidth(width: number): number {
  return Math.min(PREVIEW_SIDEBAR_WIDTH_MAX, Math.max(PREVIEW_SIDEBAR_WIDTH_MIN, Math.round(width)));
}

function attachResizeHandle(pane: HTMLElement, root: HTMLElement, getWidth: () => number, setWidth: (width: number) => void): () => void {
  const doc = pane.ownerDocument;
  const win = doc.defaultView ?? window;
  if (pane.querySelector(':scope > .preview-sidebar-resize-handle')) {
    return () => undefined;
  }
  const handle = doc.createElement('div');
  handle.className = 'preview-sidebar-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize sidebar');
  pane.append(handle);

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let activePointerId: number | null = null;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const next = clampWidth(startWidth + event.clientX - startX);
    setWidth(next);
    event.preventDefault();
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    if (activePointerId !== null) {
      try {
        handle.releasePointerCapture(activePointerId);
      } catch {
        // Pointer may already be released.
      }
      activePointerId = null;
    }
    doc.documentElement.classList.remove('preview-sidebar-resizing');
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerup', stopDrag);
    win.removeEventListener('pointercancel', stopDrag);
    writeStoredWidth(getWidth());
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startWidth = getWidth();
    activePointerId = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    doc.documentElement.classList.add('preview-sidebar-resizing');
    win.addEventListener('pointermove', onPointerMove);
    win.addEventListener('pointerup', stopDrag);
    win.addEventListener('pointercancel', stopDrag);
    event.preventDefault();
  };

  handle.addEventListener('pointerdown', onPointerDown);

  return () => {
    stopDrag();
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.remove();
  };
}

/**
 * Draggable edge on PDF and PPTX preview sidebars. Width is stored on the viewer root and
 * persisted in localStorage so thumbnails and the main pane relayout together.
 */
export function installPreviewSidebarResize(root: HTMLElement): () => void {
  const win = root.ownerDocument.defaultView ?? window;
  let width = readStoredWidth();
  const paneCleanups = new Map<HTMLElement, () => void>();

  const applyWidth = (): void => {
    root.style.setProperty(WIDTH_VAR, `${width}px`);
    win.dispatchEvent(new Event('resize'));
  };

  const setWidth = (next: number): void => {
    width = clampWidth(next);
    applyWidth();
  };

  const getWidth = (): number => width;

  const attachPane = (pane: HTMLElement): void => {
    if (paneCleanups.has(pane)) return;
    paneCleanups.set(pane, attachResizeHandle(pane, root, getWidth, setWidth));
  };

  const detachPane = (pane: HTMLElement): void => {
    paneCleanups.get(pane)?.();
    paneCleanups.delete(pane);
  };

  const scan = (): void => {
    const panes = new Set<HTMLElement>();
    Array.from(root.querySelectorAll<HTMLElement>('.pdf-nav-pane:not([hidden]), .preview-pptx-thumbs:not([hidden])')).forEach((pane) => {
      panes.add(pane);
    });
    for (const pane of paneCleanups.keys()) {
      if (!panes.has(pane)) detachPane(pane);
    }
    for (const pane of panes) attachPane(pane);
  };

  applyWidth();
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });

  return () => {
    observer.disconnect();
    for (const pane of [...paneCleanups.keys()]) detachPane(pane);
    root.style.removeProperty(WIDTH_VAR);
  };
}
