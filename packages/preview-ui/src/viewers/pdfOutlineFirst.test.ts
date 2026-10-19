/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPdfOutlineFirst } from './pdfOutlineFirst';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Minimal stand-in for @file-viewer's PDF navigation: tabs re-render the list for their mode. */
function renderPdf(outline: string[] | null) {
  document.body.innerHTML = '<div class="root"><div class="pdf-shell"><aside class="pdf-nav-pane"><div class="pdf-nav-tabs">'
    + '<button class="active">Pages</button><button>Outline</button></div><div class="list"></div></aside><div class="pdfViewer"></div></div></div>';
  const root = document.querySelector<HTMLElement>('.root')!;
  const [pagesTab, outlineTab] = Array.from(root.querySelectorAll<HTMLButtonElement>('.pdf-nav-tabs button'));
  const list = root.querySelector<HTMLElement>('.list')!;
  let mode = 'pages';
  let items = outline;
  const render = (): void => {
    pagesTab.classList.toggle('active', mode === 'pages');
    outlineTab.classList.toggle('active', mode === 'outline');
    list.innerHTML = mode === 'pages'
      ? '<button class="pdf-page-button">1</button>'
      : items?.length ? items.map(title => `<button class="pdf-outline-button">${title}</button>`).join('') : '<div class="pdf-outline-empty">None</div>';
  };
  pagesTab.addEventListener('click', () => { mode = 'pages'; render(); });
  outlineTab.addEventListener('click', () => { mode = 'outline'; render(); });
  render();
  return {
    root,
    pagesTab,
    outlineTab,
    loadOutline(next: string[]) { items = next; render(); },
    renderPages() { root.querySelector('.pdfViewer')!.innerHTML = '<div class="page"></div>'; },
  };
}

const settle = async (ms: number): Promise<void> => {
  await Promise.resolve();
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
};

it('keeps the outline tab when the document has an outline', async () => {
  const pdf = renderPdf(null);
  const dispose = installPdfOutlineFirst(pdf.root);
  expect(pdf.outlineTab.classList.contains('active')).toBe(true);

  pdf.renderPages();
  pdf.loadOutline(['Chapter 1']);
  await settle(5000);

  expect(pdf.outlineTab.classList.contains('active')).toBe(true);
  expect(pdf.root.querySelector<HTMLElement>('.pdf-nav-pane')!.dataset.outlineDefault).toBe('done');
  dispose();
});

it('falls back to pages once the document renders without an outline', async () => {
  const pdf = renderPdf(null);
  const dispose = installPdfOutlineFirst(pdf.root);
  pdf.renderPages();
  await settle(0);
  expect(pdf.root.querySelector<HTMLElement>('.pdf-nav-pane')!.dataset.outlineDefault).toBe('pending');

  await settle(1600);

  expect(pdf.pagesTab.classList.contains('active')).toBe(true);
  expect(pdf.root.querySelector<HTMLElement>('.pdf-nav-pane')!.dataset.outlineDefault).toBe('done');
  dispose();
});
