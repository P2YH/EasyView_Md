/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { installPreviewSidebarToggle } from './previewSidebarToggle';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

function mount(viewerMarkup: string): { root: HTMLElement; toolbar: HTMLElement } {
  document.body.innerHTML = `<div class="preview-universal-viewer"><div class="file-viewer-web-toolbar"><button>search</button></div>${viewerMarkup}</div>`;
  const root = document.querySelector<HTMLElement>('.preview-universal-viewer')!;
  return { root, toolbar: root.querySelector<HTMLElement>('.file-viewer-web-toolbar')! };
}

it('prepends a toggle that hides and shows the PDF navigation pane', () => {
  const { root, toolbar } = mount('<div class="pdf-shell"><div class="pdf-nav-pane"></div></div>');
  const dispose = installPreviewSidebarToggle(toolbar, root, 'Toggle sidebar');
  const toggle = toolbar.firstElementChild as HTMLButtonElement;

  expect(toggle.classList.contains('preview-sidebar-toggle')).toBe(true);
  expect(toggle.hidden).toBe(false);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(root.dataset.previewSidebar).toBe('visible');

  toggle.click();
  expect(root.dataset.previewSidebar).toBe('hidden');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem('easyview.previewSidebarHidden')).toBe('1');

  dispose();
  expect(toolbar.querySelector('.preview-sidebar-toggle')).toBeNull();
  expect(root.dataset.previewSidebar).toBeUndefined();
});

it('restores the saved state and stays hidden without a sidebar', () => {
  localStorage.setItem('easyview.previewSidebarHidden', '1');
  const { root, toolbar } = mount('<div class="file-viewer-web-shell"></div>');
  installPreviewSidebarToggle(toolbar, root, 'Toggle sidebar');

  expect(root.dataset.previewSidebar).toBe('hidden');
  expect((toolbar.firstElementChild as HTMLButtonElement).hidden).toBe(true);
});

it('re-inserts the toggle after the toolbar is rebuilt', async () => {
  const { root, toolbar } = mount('<div class="pdf-shell"></div>');
  installPreviewSidebarToggle(toolbar, root, 'Toggle sidebar');
  toolbar.replaceChildren(document.createElement('button'));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(toolbar.firstElementChild?.classList.contains('preview-sidebar-toggle')).toBe(true);
});
