/** @file-viewer loads the PDF outline asynchronously right after the first pages render. */
const OUTLINE_SETTLE_MS = 1500;
const MAX_WAIT_MS = 10000;

/**
 * Opens each PDF navigation pane on its Outline tab and switches to Pages when the document has
 * no outline. While undecided the pane carries `data-outline-default="pending"` so the
 * transient "no outline" message stays hidden. A user click on either tab ends the decision.
 */
export function installPdfOutlineFirst(root: HTMLElement): () => void {
  const win = root.ownerDocument.defaultView ?? window;
  const cleanups = new Set<() => void>();

  const decide = (pane: HTMLElement): void => {
    const [pagesTab, outlineTab] = Array.from(pane.querySelectorAll<HTMLButtonElement>('.pdf-nav-tabs > button'));
    if (!pagesTab || !outlineTab) return;
    const shell = pane.closest<HTMLElement>('.pdf-shell') ?? root;
    pane.dataset.outlineDefault = 'pending';
    outlineTab.click();

    let settleTimer = 0;
    const finish = (showPages: boolean): void => {
      if (pane.dataset.outlineDefault !== 'pending') return;
      pane.dataset.outlineDefault = 'done';
      if (showPages) pagesTab.click();
      cleanup();
    };
    const check = (): void => {
      if (pane.querySelector('.pdf-outline-button')) {
        finish(false);
        return;
      }
      if (!settleTimer && shell.querySelector('.pdfViewer .page')) {
        settleTimer = win.setTimeout(() => finish(!pane.querySelector('.pdf-outline-button')), OUTLINE_SETTLE_MS);
      }
    };
    const onUserClick = (event: MouseEvent): void => {
      if (event.isTrusted && (event.target as Element).closest('.pdf-nav-tabs')) finish(false);
    };
    const observer = new MutationObserver(check);
    observer.observe(shell, { childList: true, subtree: true });
    const maxTimer = win.setTimeout(() => finish(!pane.querySelector('.pdf-outline-button')), MAX_WAIT_MS);
    pane.addEventListener('click', onUserClick, true);
    const cleanup = (): void => {
      observer.disconnect();
      win.clearTimeout(settleTimer);
      win.clearTimeout(maxTimer);
      pane.removeEventListener('click', onUserClick, true);
      cleanups.delete(cleanup);
    };
    cleanups.add(cleanup);
    check();
  };

  const scan = (): void => {
    for (const pane of Array.from(root.querySelectorAll<HTMLElement>('.pdf-nav-pane:not([data-outline-default])'))) decide(pane);
  };
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    Array.from(cleanups).forEach(cleanup => cleanup());
  };
}
