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

/*
 * x-spreadsheet toolbar glyphs in EasyView's outline style. The library keys each glyph by an
 * `.x-spreadsheet-icon-img.<name>` class over a filled sprite; these replace the sprite through a
 * CSS mask tinted with the toolbar foreground (see preview.css), so they follow the file theme.
 * Drawn on the same 24px grid as ICONS; stroke 2.25 renders 1.5px at the 16px glyph box.
 */
const DASHED_FRAME = '<path d="M4 4h16v16H4z" stroke-dasharray="1 3"/>';
const DASHED_CROSS = '<path d="M4 12h16M12 4v16" stroke-dasharray="1 3"/>';
const xsPath = (d: string): string => `<path d="${d}"/>`;

export const SPREADSHEET_TOOLBAR_ICONS: Record<string, string> = {
  undo: xsPath('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  redo: xsPath('m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
  print: xsPath('M7 9V4h10v5M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H18M7 14h10v6H7z'),
  paintformat: xsPath('M5 4h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM18 6.5h2v5h-8v3M11 14.5h2v6h-2z'),
  clearformat: xsPath('M5 7V5h12v2M11 5 8 19M14 14l6 6M20 14l-6 6'),
  'font-bold': xsPath('M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z'),
  'font-italic': xsPath('M19 4h-9M14 20H5M15 4 9 20'),
  underline: xsPath('M7 4v6a5 5 0 0 0 10 0V4M5 20h14'),
  strike: xsPath('M16 6.5C15.3 5 13.8 4 12 4c-2.5 0-4.5 1.5-4.5 3.8 0 1.4.8 2.5 2.4 3.2M4 12h16M8 17c.7 1.8 2.3 3 4.3 3 2.6 0 4.7-1.6 4.7-3.8 0-.8-.2-1.5-.7-2.2'),
  color: xsPath('M6 20 12 4l6 16M8.3 14h7.4'),
  bgcolor: xsPath('m18 11-7-7-7.5 7.5a2 2 0 0 0 0 2.8l4.2 4.2a2 2 0 0 0 2.8 0zM6 3l4 4M3 12.5h14.5M20.5 15.5s-1.5 1.8-1.5 2.8a1.5 1.5 0 0 0 3 0c0-1-1.5-2.8-1.5-2.8z'),
  'border-all': xsPath('M4 4h16v16H4zM4 12h16M12 4v16'),
  'border-inside': DASHED_FRAME + xsPath('M4 12h16M12 4v16'),
  'border-horizontal': DASHED_FRAME + xsPath('M4 12h16') + '<path d="M12 4v16" stroke-dasharray="1 3"/>',
  'border-vertical': DASHED_FRAME + xsPath('M12 4v16') + '<path d="M4 12h16" stroke-dasharray="1 3"/>',
  'border-outside': xsPath('M4 4h16v16H4z') + DASHED_CROSS,
  'border-left': '<path d="M4 4h16v16H4" stroke-dasharray="1 3"/>' + DASHED_CROSS + xsPath('M4 4v16'),
  'border-top': '<path d="M20 4v16H4V4" stroke-dasharray="1 3"/>' + DASHED_CROSS + xsPath('M4 4h16'),
  'border-right': '<path d="M20 20H4V4h16" stroke-dasharray="1 3"/>' + DASHED_CROSS + xsPath('M20 4v16'),
  'border-bottom': '<path d="M4 20V4h16v16" stroke-dasharray="1 3"/>' + DASHED_CROSS + xsPath('M4 20h16'),
  'border-none': DASHED_FRAME + DASHED_CROSS,
  'line-color': xsPath('m14.5 4.5 3 3L9 16H6v-3z'),
  'line-type': xsPath('M4 6h16M4 12h16') + '<path d="M4 18h16" stroke-dasharray="2 3"/>',
  merge: xsPath('M4 4h16v16H4zM12 4v4M12 16v4M8 9l3 3-3 3M16 9l-3 3 3 3'),
  'align-left': xsPath('M4 6h16M4 10h10M4 14h16M4 18h10'),
  'align-center': xsPath('M4 6h16M7 10h10M4 14h16M7 18h10'),
  'align-right': xsPath('M4 6h16M10 10h10M4 14h16M10 18h10'),
  'align-top': xsPath('M4 4h16M12 20V8M8 12l4-4 4 4'),
  'align-middle': xsPath('M4 12h16M12 3v5M9 5.5 12 8l3-2.5M12 21v-5M9 18.5l3-2.5 3 2.5'),
  'align-bottom': xsPath('M4 20h16M12 4v12M8 12l4 4 4-4'),
  textwrap: xsPath('M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h6'),
  freeze: xsPath('M4 4h16v16H4zM4 9h16M9 4v16'),
  autofilter: xsPath('M4 5h16l-6 7.5V19l-4 1.5v-8z'),
  formula: xsPath('M18 5H6l6 7-6 7h12'),
  'arrow-down': xsPath('m8 10 4 4 4-4'),
  'arrow-right': xsPath('m10 8 4 4-4 4'),
  'chevron-down': xsPath('m7 10 5 5 5-5'),
  'chevron-up': xsPath('m7 14 5-5 5 5'),
  'chevron-left': xsPath('m14 7-5 5 5 5'),
  'chevron-right': xsPath('m10 7 5 5-5 5'),
  ellipsis: xsPath('M6 12h.01M12 12h.01M18 12h.01'),
  add: xsPath('M12 5v14M5 12h14'),
  close: xsPath('M6 6l12 12M18 6 6 18'),
  link: xsPath('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  chart: xsPath('M4 20h16M7 16v-5M12 16V6M17 16V8'),
};

function svgMaskUrl(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** One `--xs-icon` mask per x-spreadsheet glyph class, scoped to EasyView's spreadsheet editor. */
export function spreadsheetToolbarIconCss(scope = '.preview-spreadsheet-editor .x-spreadsheet-toolbar'): string {
  return Object.entries(SPREADSHEET_TOOLBAR_ICONS)
    .map(([name, body]) => `${scope} .x-spreadsheet-icon-img.${name}{--xs-icon:${svgMaskUrl(body)}}`)
    .join('\n');
}
