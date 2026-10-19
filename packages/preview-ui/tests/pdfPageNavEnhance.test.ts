/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { installPdfPageNavEnhance } from '../src/viewers/pdfPageNavEnhance';

afterEach(() => {
  document.body.innerHTML = '';
});

it('wraps PDF page thumbnails with the PPTX rail classes', async () => {
  document.body.innerHTML = `
    <div class="root">
      <div class="pdf-page-list">
        <button type="button" class="pdf-page-button pdf-page-button--with-thumbnail">
          <span class="pdf-page-thumb pdf-page-thumb--thumbnail" data-pdf-thumbnail-page="2"></span>
          <span class="pdf-page-label">Page 2</span>
        </button>
      </div>
    </div>`;
  const root = document.querySelector<HTMLElement>('.root')!;
  const dispose = installPdfPageNavEnhance(root);
  const button = root.querySelector<HTMLButtonElement>('.pdf-page-button')!;
  expect(button.classList.contains('preview-pptx-thumb')).toBe(true);
  expect(button.querySelector('.preview-pptx-thumb-index')?.textContent).toBe('2');
  expect(button.querySelector('.pdf-page-label')).toBeNull();
  expect(button.querySelector('.preview-pptx-thumb-frame .pdf-page-thumb--thumbnail')).not.toBeNull();
  button.classList.add('pdf-page-button--active');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(button.classList.contains('is-active')).toBe(true);
  dispose();
});

it('sizes each frame to its page thumbnail ratio and remembers it for pending pages', async () => {
  document.body.innerHTML = `
    <div class="root"><div class="pdf-nav-pane">
      <div class="pdf-page-list">
        <button type="button" class="pdf-page-button pdf-page-button--with-thumbnail">
          <span class="pdf-page-thumb pdf-page-thumb--thumbnail" data-pdf-thumbnail-page="1"><span>1</span></span>
          <span class="pdf-page-label">Page 1</span>
        </button>
      </div>
    </div></div>`;
  const root = document.querySelector<HTMLElement>('.root')!;
  const dispose = installPdfPageNavEnhance(root);
  const image = document.createElement('img');
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 92 },
    naturalHeight: { value: 52 },
  });
  root.querySelector('.pdf-page-thumb--thumbnail')!.replaceChildren(image);
  image.dispatchEvent(new Event('load'));

  expect(root.querySelector<HTMLElement>('.preview-pptx-thumb-frame')!.style.aspectRatio).toBe('92 / 52');
  expect(root.querySelector<HTMLElement>('.pdf-nav-pane')!.style.getPropertyValue('--preview-pdf-thumb-ratio')).toBe('92 / 52');
  dispose();
});
