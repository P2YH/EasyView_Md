const icon = (body: string): string => `<svg class="preview-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  download: icon('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  print: icon('<path d="M7 9V4h10v5M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H18M7 14h10v6H7z"/>'),
  exportHtml: icon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  zoomOut: icon('<path d="M5 12h14"/>'),
  zoomIn: icon('<path d="M12 5v14M5 12h14"/>'),
  zoomReset: icon('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 12h0"/>'),
};

/** Zoom buttons carry locale-independent glyphs; "HTML" is the export label in every locale. */
const ZOOM_GLYPHS: Record<string, string> = { '-': ICONS.zoomOut, '+': ICONS.zoomIn, '1:1': ICONS.zoomReset };

function setIcon(button: HTMLButtonElement, svg: string): void {
  if (button.querySelector('.preview-toolbar-icon')) return;
  button.innerHTML = svg;
  button.classList.add('preview-toolbar-icon-button');
}

/** Swap @file-viewer's text action buttons for icons; titles stay as hover hints. */
export function installCompactToolbarIcons(toolbar: HTMLElement): () => void {
  const sync = (): void => {
    for (const button of Array.from(toolbar.querySelectorAll<HTMLButtonElement>(':scope > .file-viewer-web-toolbar-group > .file-viewer-web-icon-button'))) {
      const svg = ZOOM_GLYPHS[button.textContent?.trim() ?? ''];
      if (svg) setIcon(button, svg);
    }
    for (const button of Array.from(toolbar.querySelectorAll<HTMLButtonElement>(':scope > button'))) {
      if (button.classList.length) continue;
      setIcon(button, button.textContent?.trim() === 'HTML' ? ICONS.exportHtml : ICONS.download);
    }
    const printTrigger = toolbar.querySelector<HTMLButtonElement>(':scope > .file-viewer-web-print-menu > button[aria-haspopup="menu"]');
    if (printTrigger) setIcon(printTrigger, ICONS.print);
  };
  const observer = new MutationObserver(sync);
  observer.observe(toolbar, { childList: true });
  sync();
  return () => observer.disconnect();
}
