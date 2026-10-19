import { expect, it, vi } from 'vitest';
import { pptxSlideMaterializer, registerPptxViewerClass } from './pptxSlideMaterializer';

it('finds the viewer that owns a deck element once it opens', async () => {
  const ensureSlideRendered = vi.fn(() => ({}) as Element);
  const scheduleSlideWindowUpdate = vi.fn();
  class FakeViewer {
    readonly content = {} as HTMLElement;
    ensureSlideRendered = ensureSlideRendered;
    scheduleSlideWindowUpdate = scheduleSlideWindowUpdate;
    async open(): Promise<void> {}
  }
  registerPptxViewerClass(FakeViewer);
  registerPptxViewerClass(FakeViewer);
  const viewer = new FakeViewer();
  const materializer = pptxSlideMaterializer(viewer.content);
  expect(materializer.render(3)).toBe(false);

  await viewer.open();
  expect(materializer.render(3)).toBe(true);
  expect(ensureSlideRendered).toHaveBeenCalledWith(3);
  materializer.release();
  expect(scheduleSlideWindowUpdate).toHaveBeenCalledTimes(1);
});
