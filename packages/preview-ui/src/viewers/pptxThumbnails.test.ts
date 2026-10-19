/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPptxThumbnails } from './pptxThumbnails';

const labels = {
  list: 'Slide thumbnails',
  outline: 'Outline',
  pages: 'Pages',
  outlineEmpty: 'No outline',
  slide: (index: number) => `Slide ${index}`,
};

/** Lets each test decide which thumbnails are in the rail's viewport (happy-dom has no layout). */
class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | null = null;
  readonly targets: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.current = this;
  }
  observe(target: Element): void { this.targets.push(target); }
  unobserve(): void {}
  disconnect(): void {}
  show(slides: number[]): void {
    this.callback(this.targets.map(target => ({
      target,
      isIntersecting: slides.includes(Number((target as HTMLElement).dataset.slide)),
    }) as IntersectionObserverEntry), this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  bitmapRasterizer.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const showSlides = (slides: number[]): void => FakeIntersectionObserver.current!.show(slides);
const bitmapRasterizer = vi.fn(async (slide: { markup: string }) => `blob:${/Slide body (\d+)/.exec(slide.markup)?.[1]}`);
const bitmaps = (shell: HTMLElement): string[] => Array.from(shell.querySelectorAll<HTMLImageElement>('.preview-pptx-thumb-image')).map(image => image.getAttribute('src')!);
const pagesFirst = Promise.resolve<string[]>([]);

/** Mirrors the windowed deck @file-viewer/pptx renders: one fixed slot per slide, slides mounted lazily. */
function renderDeck(slides: number, mounted: number[]) {
  document.body.innerHTML = '<div class="file-viewer-web-shell"><div class="file-viewer-web-toolbar"></div>'
    + '<div class="file-viewer-web-content"><div class="pptx-render-surface"><div class="flyfish-pptx-content"></div></div></div></div>';
  const shell = document.querySelector<HTMLElement>('.file-viewer-web-shell')!;
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 1000 });
  const content = document.querySelector<HTMLElement>('.flyfish-pptx-content')!;
  for (let index = 1; index <= slides; index += 1) {
    const slot = document.createElement('div');
    slot.className = 'flyfish-pptx-slide-slot';
    slot.dataset.slideNumber = String(index);
    content.append(slot);
    if (mounted.includes(index)) mountSlide(slot, index);
  }
  return { shell, content, scroller: document.querySelector<HTMLElement>('.file-viewer-web-content')! };
}

function mountSlide(slot: HTMLElement, index: number): void {
  slot.innerHTML = `<div class="slide" style="width: 1280px; height: 720px;"><span class="_css_1">Slide body ${index}</span></div>`;
}

const flush = async (): Promise<void> => {
  for (let step = 0; step < 4; step += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
  }
};

it('lists every slide and stores visible mounted slides as bitmaps', async () => {
  const { shell, content } = renderDeck(4, [1, 2]);
  const dispose = installPptxThumbnails(content, labels, pagesFirst, undefined, bitmapRasterizer);
  await flush();
  showSlides([1, 2, 3, 4]);
  await flush();

  const nav = shell.querySelector('.preview-pptx-thumbs')!;
  expect(shell.classList.contains('has-pptx-thumbs')).toBe(true);
  expect(Array.from(nav.querySelectorAll<HTMLElement>('.preview-pptx-thumb')).map(item => item.dataset.slide)).toEqual(['1', '2', '3', '4']);
  expect(bitmaps(shell)).toEqual(['blob:1', 'blob:2']);
  expect(nav.querySelector('.preview-pptx-thumb-stage')).toBeNull();
  expect(bitmapRasterizer.mock.calls[0][0].markup).toContain('flyfish-pptx-content');
  expect(nav.querySelector('[data-slide="3"] .preview-pptx-thumb-frame')!.childElementCount).toBe(0);

  dispose();
  expect(shell.querySelector('.preview-pptx-thumbs')).toBeNull();
  expect(shell.classList.contains('has-pptx-thumbs')).toBe(false);
});

it('captures a wanted slide once the renderer mounts it and keeps it after unmount', async () => {
  const { shell, content } = renderDeck(3, [1]);
  const dispose = installPptxThumbnails(content, labels, pagesFirst, undefined, bitmapRasterizer);
  await flush();
  showSlides([1, 2, 3]);
  await flush();

  const slot = content.querySelector<HTMLElement>('[data-slide-number="3"]')!;
  mountSlide(slot, 3);
  await flush();
  slot.replaceChildren();
  await flush();

  expect(bitmaps(shell)).toEqual(['blob:1', 'blob:3']);
  dispose();
});

it('falls back to a DOM clone when a slide cannot be rasterized', async () => {
  const { shell, content } = renderDeck(2, [1]);
  const dispose = installPptxThumbnails(content, labels, pagesFirst, undefined, async () => null);
  await flush();
  showSlides([1, 2]);
  await flush();

  expect(shell.querySelector('[data-slide="1"] .preview-pptx-thumb-stage.flyfish-pptx-content')?.textContent).toBe('Slide body 1');
  dispose();
});

it('scrolls the deck to a clicked slide and marks it active', async () => {
  const { shell, content, scroller } = renderDeck(3, [1]);
  const slot = content.querySelector<HTMLElement>('[data-slide-number="2"]')!;
  vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 1400, left: 0, right: 0, width: 0, height: 700, x: 0, y: 700, toJSON: () => ({}) });
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 800, left: 0, right: 0, width: 0, height: 700, x: 0, y: 100, toJSON: () => ({}) });
  const dispose = installPptxThumbnails(content, labels);

  shell.querySelector<HTMLButtonElement>('[data-slide="2"]')!.click();

  expect(scroller.scrollTop).toBe(600);
  const item = shell.querySelector('[data-slide="2"]')!;
  expect(item.classList.contains('is-active')).toBe(true);
  expect(item.getAttribute('aria-current')).toBe('true');
  dispose();
});

it('opens on the outline when slides have titles', async () => {
  const { shell, content } = renderDeck(3, []);
  const dispose = installPptxThumbnails(content, labels, Promise.resolve(['Intro', '', 'Plan']));
  await flush();

  const nav = shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!;
  expect(nav.dataset.mode).toBe('outline');
  expect(Array.from(nav.querySelectorAll('.preview-pptx-tabs button')).map(tab => tab.textContent)).toEqual(['Outline', 'Pages']);
  expect(Array.from(nav.querySelectorAll<HTMLElement>('.preview-pptx-outline-item')).map(item => `${item.dataset.slide}:${item.title}`)).toEqual(['1:Intro', '3:Plan']);
  expect(nav.querySelector<HTMLElement>('.preview-pptx-thumb-list')!.hidden).toBe(true);
  dispose();
});

it('falls back to pages when no slide has a title, unless the user picked a tab', async () => {
  const first = renderDeck(2, []);
  let dispose = installPptxThumbnails(first.content, labels, Promise.resolve(['', '']));
  await flush();
  expect(first.shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!.dataset.mode).toBe('pages');
  dispose();

  const second = renderDeck(2, []);
  let resolveTitles: (titles: string[]) => void = () => undefined;
  dispose = installPptxThumbnails(second.content, labels, new Promise(resolve => { resolveTitles = resolve; }));
  second.shell.querySelector<HTMLButtonElement>('.preview-pptx-tabs [data-mode="outline"]')!.click();
  resolveTitles([]);
  await flush();
  const nav = second.shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!;
  expect(nav.dataset.mode).toBe('outline');
  expect(nav.querySelector('.preview-pptx-outline-empty')?.textContent).toBe('No outline');
  dispose();
});

it('mounts only the slides visible in the rail, captures them and releases them again', async () => {
  const { shell, content } = renderDeck(10, [1]);
  const forced = new Set<number>();
  const render = vi.fn((slide: number) => {
    mountSlide(content.querySelector<HTMLElement>(`[data-slide-number="${slide}"]`)!, slide);
    forced.add(slide);
    return true;
  });
  const release = vi.fn(() => {
    forced.forEach(slide => content.querySelector(`[data-slide-number="${slide}"]`)!.replaceChildren());
    forced.clear();
  });
  const dispose = installPptxThumbnails(content, labels, pagesFirst, { render, release }, bitmapRasterizer);
  await flush();
  showSlides([6, 7, 8]);
  for (let step = 0; step < 6; step += 1) await flush();

  expect(render.mock.calls.map(([slide]) => slide)).toEqual([6, 7, 8]);
  expect(bitmaps(shell)).toEqual(['blob:6', 'blob:7', 'blob:8']);
  expect(release).toHaveBeenCalledTimes(3);
  expect(content.querySelectorAll('.flyfish-pptx-slide-slot > .slide')).toHaveLength(1);

  // Scrolling the rail to the end captures those slides too; nothing runs in the background.
  showSlides([9, 10]);
  for (let step = 0; step < 6; step += 1) await flush();
  expect(bitmaps(shell)).toEqual(['blob:6', 'blob:7', 'blob:8', 'blob:9', 'blob:10']);
  dispose();
});

it('does no capture work on the Outline tab and resumes on Pages', async () => {
  const { shell, content } = renderDeck(3, [1]);
  const render = vi.fn(() => true);
  const dispose = installPptxThumbnails(content, labels, Promise.resolve(['Intro', 'Plan', 'End']), { render, release: vi.fn() }, bitmapRasterizer);
  await flush();
  showSlides([1, 2, 3]);
  await flush();
  expect(shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!.dataset.mode).toBe('outline');
  expect(bitmapRasterizer).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();

  shell.querySelector<HTMLButtonElement>('.preview-pptx-tabs [data-mode="pages"]')!.click();
  await flush();
  expect(bitmaps(shell)).toContain('blob:1');
  dispose();
});

it('pauses while the rail is collapsed', async () => {
  const { shell, content } = renderDeck(2, [1, 2]);
  const dispose = installPptxThumbnails(content, labels, pagesFirst, undefined, bitmapRasterizer);
  shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!.style.display = 'none';
  await flush();
  showSlides([1, 2]);
  await flush();
  expect(bitmapRasterizer).not.toHaveBeenCalled();

  shell.querySelector<HTMLElement>('.preview-pptx-thumbs')!.style.display = '';
  showSlides([1, 2]);
  await flush();
  expect(bitmaps(shell)).toEqual(['blob:1', 'blob:2']);
  dispose();
});

it('falls back to slides the deck mounts itself when the deck viewer cannot mount slides', async () => {
  const { shell, content } = renderDeck(3, [1]);
  const render = vi.fn(() => false);
  const dispose = installPptxThumbnails(content, labels, pagesFirst, { render, release: vi.fn() }, bitmapRasterizer);
  await flush();
  showSlides([1, 2, 3]);
  for (let step = 0; step < 4; step += 1) await flush();

  expect(render).toHaveBeenCalledTimes(1);
  expect(bitmaps(shell)).toEqual(['blob:1']);
  dispose();
});
