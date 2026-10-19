/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import {
  PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY,
  installPreviewSidebarResize,
} from './previewSidebarResize';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

it('persists sidebar width on the viewer root and in localStorage', () => {
  document.body.innerHTML = `
    <div class="preview-universal-viewer">
      <aside class="pdf-nav-pane"></aside>
    </div>`;
  const root = document.querySelector<HTMLElement>('.preview-universal-viewer')!;
  const dispose = installPreviewSidebarResize(root);
  expect(root.style.getPropertyValue('--preview-sidebar-width')).toBe('168px');

  const handle = root.querySelector<HTMLElement>('.preview-sidebar-resize-handle')!;
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 1, button: 0 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, pointerId: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));

  expect(root.style.getPropertyValue('--preview-sidebar-width')).toBe('208px');
  expect(localStorage.getItem(PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('208');
  dispose();
});

it('restores a previously saved width', () => {
  localStorage.setItem(PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY, '240');
  document.body.innerHTML = '<div class="preview-universal-viewer"><nav class="preview-pptx-thumbs"></nav></div>';
  const root = document.querySelector<HTMLElement>('.preview-universal-viewer')!;
  installPreviewSidebarResize(root);
  expect(root.style.getPropertyValue('--preview-sidebar-width')).toBe('240px');
});

it('adds a resize handle to the Word outline rail', () => {
  document.body.innerHTML = '<div class="preview-universal-viewer"><nav class="preview-word-outline"></nav></div>';
  const root = document.querySelector<HTMLElement>('.preview-universal-viewer')!;
  const dispose = installPreviewSidebarResize(root);
  expect(root.querySelector('.preview-word-outline > .preview-sidebar-resize-handle')).not.toBeNull();
  dispose();
});
