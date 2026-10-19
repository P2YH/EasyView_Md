const INTERACTIVE = 'button, a, input, select, textarea, [contenteditable], [role="tab"], [role="button"], [role="menuitem"], .desktop-tab, .ai-chat-resizer';

interface TitleBarDoubleClickOptions {
  root: HTMLElement;
  /** Height of the top chrome row in the page's CSS pixels. */
  chromeHeight(): number;
  onDoubleClick(): void;
}

/** A hidden macOS title bar leaves double-clicks on the draggable top row to the app. */
export function installTitleBarDoubleClick({ root, chromeHeight, onDoubleClick }: TitleBarDoubleClickOptions): () => void {
  const handle = (event: MouseEvent): void => {
    if (event.button !== 0 || event.clientY < 0 || event.clientY >= chromeHeight()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(INTERACTIVE)) return;
    onDoubleClick();
  };
  root.addEventListener('dblclick', handle);
  return () => root.removeEventListener('dblclick', handle);
}
