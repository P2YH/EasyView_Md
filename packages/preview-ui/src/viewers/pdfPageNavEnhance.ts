const ENHANCED = 'data-preview-page-enhanced';
const RATIO_VAR = '--preview-pdf-thumb-ratio';

/**
 * Restyles @file-viewer PDF page rows to reuse the PPTX thumbnail rail layout
 * (`preview-pptx-thumb-*` classes) while keeping native navigation behavior.
 */
export function installPdfPageNavEnhance(root: HTMLElement): () => void {
  const doc = root.ownerDocument;

  const enhanceButton = (button: HTMLButtonElement, page: number): void => {
    if (button.getAttribute(ENHANCED) === '1') return;
    if (!button.classList.contains('pdf-page-button--with-thumbnail')) return;
    button.setAttribute(ENHANCED, '1');
    button.classList.add('preview-pptx-thumb');

    const thumb = button.querySelector<HTMLElement>('.pdf-page-thumb--thumbnail');
    const label = button.querySelector<HTMLElement>('.pdf-page-label');
    if (!thumb) return;

    let index = button.querySelector<HTMLElement>('.preview-pptx-thumb-index');
    if (!index) {
      index = doc.createElement('span');
      index.className = 'preview-pptx-thumb-index';
      button.prepend(index);
    }
    index.textContent = String(page);

    let frame = thumb.parentElement?.classList.contains('preview-pptx-thumb-frame')
      ? thumb.parentElement as HTMLElement
      : null;
    if (!frame) {
      frame = doc.createElement('span');
      frame.className = 'preview-pptx-thumb-frame';
      thumb.before(frame);
      frame.append(thumb);
    }

    label?.remove();

    // Only write on change: this observer watches `class`, and a no-op write would re-trigger it.
    const syncActive = (): void => {
      const active = button.classList.contains('pdf-page-button--active');
      if (button.classList.contains('is-active') !== active) button.classList.toggle('is-active', active);
    };
    syncActive();
    const classObserver = new MutationObserver(syncActive);
    classObserver.observe(button, { attributes: true, attributeFilter: ['class'] });
    button.dataset.previewPageNavObserver = '1';
    (button as HTMLButtonElement & { __previewPageNavObserver?: MutationObserver }).__previewPageNavObserver = classObserver;
  };

  const enhanceList = (list: HTMLElement): void => {
    const buttons = list.querySelectorAll<HTMLButtonElement>('.pdf-page-button');
    buttons.forEach((button, index) => {
      const page = Number(button.querySelector<HTMLElement>('[data-pdf-thumbnail-page]')?.dataset.pdfThumbnailPage)
        || index + 1;
      enhanceButton(button, page);
    });
  };

  /**
   * Gives each frame the real page ratio once its thumbnail image is decoded, so portrait and
   * landscape pages keep their shape; pages still waiting reuse the last ratio seen in the pane.
   */
  const syncRatio = (image: HTMLImageElement): void => {
    const frame = image.closest<HTMLElement>('.preview-pptx-thumb-frame');
    if (!frame || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
    const ratio = `${image.naturalWidth} / ${image.naturalHeight}`;
    if (frame.style.aspectRatio !== ratio) frame.style.aspectRatio = ratio;
    frame.closest<HTMLElement>('.pdf-nav-pane')?.style.setProperty(RATIO_VAR, ratio);
  };

  const scan = (): void => {
    Array.from(root.querySelectorAll<HTMLElement>('.pdf-page-list')).forEach(enhanceList);
    Array.from(root.querySelectorAll<HTMLImageElement>('.preview-pptx-thumb-frame .pdf-page-thumb--thumbnail img')).forEach(syncRatio);
  };

  const onLoad = (event: Event): void => {
    const target = event.target as Element | null;
    if (target?.tagName === 'IMG' && target.closest('.pdf-page-thumb--thumbnail')) syncRatio(target as HTMLImageElement);
  };

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  // `load` does not bubble; listen in the capture phase for thumbnails decoded after insertion.
  root.addEventListener('load', onLoad, true);

  return () => {
    observer.disconnect();
    root.removeEventListener('load', onLoad, true);
    Array.from(root.querySelectorAll<HTMLButtonElement>('.preview-pptx-thumb[data-preview-page-enhanced="1"]')).forEach((button) => {
      const classObserver = (button as HTMLButtonElement & { __previewPageNavObserver?: MutationObserver }).__previewPageNavObserver;
      classObserver?.disconnect();
      delete (button as HTMLButtonElement & { __previewPageNavObserver?: MutationObserver }).__previewPageNavObserver;
      button.removeAttribute(ENHANCED);
      button.classList.remove('preview-pptx-thumb', 'is-active');
    });
  };
}
