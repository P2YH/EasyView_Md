const STORAGE_KEY = 'easyview.previewSidebarHidden';
/** Viewers that render a left navigation pane: PDF pages/outline and the PPTX thumbnail rail. */
const SIDEBAR_SELECTOR = '.pdf-shell:not(.pdf-shell--nav-hidden), .file-viewer-web-shell.has-pptx-thumbs';
const ICON = '<svg class="preview-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15M5.75 8.5h1.5M5.75 11.5h1.5"/></svg>';

function readHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0');
  } catch {
    // Storage may be unavailable in sandboxed webviews; the toggle still works per session.
  }
}

/**
 * Leading toolbar button that shows or hides the viewer's left navigation pane. The state lives
 * on the viewer root as `data-preview-sidebar` because React owns the root's className.
 */
export function installPreviewSidebarToggle(toolbar: HTMLElement, root: HTMLElement, label: string): () => void {
  const doc = toolbar.ownerDocument;
  const win = doc.defaultView ?? window;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'preview-toolbar-icon-button preview-sidebar-toggle';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = ICON;

  let hidden = readHidden();
  let frame = 0;

  const apply = (): void => {
    root.dataset.previewSidebar = hidden ? 'hidden' : 'visible';
    button.setAttribute('aria-pressed', String(!hidden));
  };

  const sync = (): void => {
    frame = 0;
    button.hidden = !root.querySelector(SIDEBAR_SELECTOR);
    if (toolbar.firstElementChild !== button) toolbar.prepend(button);
  };
  const scheduleSync = (): void => {
    if (!frame) frame = win.requestAnimationFrame(sync);
  };

  const onClick = (): void => {
    hidden = !hidden;
    writeHidden(hidden);
    apply();
  };

  button.addEventListener('click', onClick);
  const toolbarObserver = new MutationObserver(sync);
  toolbarObserver.observe(toolbar, { childList: true });
  const rootObserver = new MutationObserver(scheduleSync);
  rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  apply();
  sync();

  return () => {
    toolbarObserver.disconnect();
    rootObserver.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
    button.removeEventListener('click', onClick);
    button.remove();
    delete root.dataset.previewSidebar;
  };
}
