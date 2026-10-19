import type { PptxSlideMaterializer } from './pptxSlideMaterializer';
import { prepareSlide, rasterizeSlide, thumbnailPixelScale, type SlideRasterizer } from './pptxThumbnailRaster';

const SLOT_SELECTOR = '.flyfish-pptx-slide-slot';
const MIN_SHELL_WIDTH = 560;
/** Slides finish hydrating media and charts shortly after they are mounted. */
const CAPTURE_DELAY_MS = 400;
/** Pause between captures so scrolling the deck stays responsive. */
const CAPTURE_GAP_MS = 40;
/** Give up on a slide that still cannot be captured after this many tries. */
const MAX_CAPTURE_ATTEMPTS = 3;
/** Thumbnails within about one rail height above and below the visible ones are captured. */
const PREFETCH_MARGIN = '100% 0px';
/** Re-capture a bitmap once its frame has grown this much (the rail was dragged wider). */
const RECAPTURE_GROWTH = 1.15;
/** Bitmaps encoded concurrently. */
const MAX_ENCODING = 2;

type PptxNavMode = 'outline' | 'pages';

interface PptxThumbnailLabels {
  list: string;
  outline: string;
  pages: string;
  outlineEmpty: string;
  slide(index: number): string;
}

/**
 * Left navigation rail for the windowed PPTX renderer: an outline of slide titles and a
 * thumbnail list. The outline is shown first unless the deck has no titled slides. Off-screen
 * slides are unmounted by the renderer, and it only mounts slides near the main viewport, so the
 * rail captures thumbnails on demand: only slides whose thumbnail is in (or about one rail height
 * around) the visible part of the Pages list are captured, one at a time. A slide the deck has
 * not mounted is mounted through the materializer, serialized, and released again. Each capture
 * is kept as a small bitmap sized to the frame (see pptxThumbnailRaster), falling back to a DOM
 * clone when rasterizing fails. Nothing is captured while the rail is hidden or on the Outline tab.
 */
export function installPptxThumbnails(
  content: HTMLElement,
  labels: PptxThumbnailLabels,
  titles: Promise<string[]> = Promise.resolve([]),
  materializer?: PptxSlideMaterializer,
  rasterizer: SlideRasterizer = rasterizeSlide,
): () => void {
  const shell = content.closest<HTMLElement>('.file-viewer-web-shell');
  const scroller = content.closest<HTMLElement>('.file-viewer-web-content');
  if (!shell || !scroller || scroller.parentElement !== shell) return () => undefined;
  const doc = content.ownerDocument;
  const win = doc.defaultView ?? window;

  const nav = doc.createElement('nav');
  nav.className = 'preview-pptx-thumbs';
  nav.setAttribute('aria-label', labels.list);
  const tabs = doc.createElement('div');
  tabs.className = 'preview-pptx-tabs';
  tabs.setAttribute('role', 'tablist');
  const makeTab = (mode: PptxNavMode, text: string): HTMLButtonElement => {
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.dataset.mode = mode;
    tab.setAttribute('role', 'tab');
    tab.textContent = text;
    return tab;
  };
  const outlineTab = makeTab('outline', labels.outline);
  const pagesTab = makeTab('pages', labels.pages);
  tabs.append(outlineTab, pagesTab);
  const thumbList = doc.createElement('div');
  thumbList.className = 'preview-pptx-thumb-list';
  const outlineList = doc.createElement('div');
  outlineList.className = 'preview-pptx-outline';
  outlineList.dataset.state = 'loading';
  nav.append(tabs, outlineList, thumbList);
  shell.append(nav);

  const items = new Map<number, HTMLButtonElement>();
  const outlineItems = new Map<number, HTMLButtonElement>();
  /** Slides with an up-to-date thumbnail, mapped to the frame width they were captured at. */
  const captured = new Map<number, number>();
  const objectUrls = new Map<number, string>();
  const attempts = new Map<number, number>();
  const visibleSlides = new Set<number>();
  let pumpTimer = 0;
  const encoding = new Set<number>();
  let slideWidth = 1280;
  let activeSlide = 0;
  let scrollFrame = 0;
  let mode: PptxNavMode = 'outline';
  let userChoseMode = false;
  let disposed = false;

  const slotOf = (slide: number): HTMLElement | null => content.querySelector<HTMLElement>(`${SLOT_SELECTOR}[data-slide-number="${slide}"]`);

  const layout = (): void => {
    const visible = shell.clientWidth >= MIN_SHELL_WIDTH;
    shell.classList.toggle('has-pptx-thumbs', visible);
    nav.hidden = !visible;
    nav.style.top = `${scroller.offsetTop}px`;
    const frame = nav.querySelector<HTMLElement>('.preview-pptx-thumb-frame');
    if (!frame?.clientWidth) return;
    nav.style.setProperty('--pptx-thumb-scale', String(frame.clientWidth / slideWidth));
    // A wider rail would upscale the bitmaps; mark them stale so visible ones are re-captured.
    let stale = false;
    captured.forEach((width, slide) => {
      if (frame.clientWidth > width * RECAPTURE_GROWTH) {
        captured.delete(slide);
        attempts.delete(slide);
        stale = true;
      }
    });
    if (stale) pump();
  };

  const revealActive = (): void => {
    const list = mode === 'pages' ? thumbList : outlineList;
    const item = (mode === 'pages' ? items : outlineItems).get(activeSlide);
    if (!item) return;
    const top = item.offsetTop - list.offsetTop - list.scrollTop;
    if (top < 0) list.scrollTop += top - 4;
    else if (top + item.offsetHeight > list.clientHeight) list.scrollTop += top + item.offsetHeight - list.clientHeight + 4;
  };

  const setMode = (next: PptxNavMode): void => {
    mode = next;
    nav.dataset.mode = next;
    for (const tab of [outlineTab, pagesTab]) {
      const selected = tab.dataset.mode === next;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    }
    outlineList.hidden = next !== 'outline';
    thumbList.hidden = next !== 'pages';
    layout();
    revealActive();
    pump();
  };

  const ensureItem = (slide: number): HTMLButtonElement => {
    let item = items.get(slide);
    if (item) return item;
    item = doc.createElement('button');
    item.type = 'button';
    item.className = 'preview-pptx-thumb';
    item.dataset.slide = String(slide);
    item.title = labels.slide(slide);
    item.setAttribute('aria-label', labels.slide(slide));
    const index = doc.createElement('span');
    index.className = 'preview-pptx-thumb-index';
    index.textContent = String(slide);
    const frame = doc.createElement('span');
    frame.className = 'preview-pptx-thumb-frame';
    item.append(index, frame);
    items.set(slide, item);
    thumbObserver?.observe(item);
    const next = [...items.keys()].filter(key => key > slide).sort((a, b) => a - b)[0];
    thumbList.insertBefore(item, next === undefined ? null : items.get(next)!);
    return item;
  };

  const renderOutline = (slideTitles: string[]): void => {
    outlineList.replaceChildren();
    outlineItems.clear();
    slideTitles.forEach((title, index) => {
      if (!title) return;
      const slide = index + 1;
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'preview-pptx-outline-item';
      item.dataset.slide = String(slide);
      item.title = title;
      const number = doc.createElement('span');
      number.className = 'preview-pptx-outline-index';
      number.textContent = String(slide);
      const text = doc.createElement('span');
      text.className = 'preview-pptx-outline-title';
      text.textContent = title;
      item.append(number, text);
      item.classList.toggle('is-active', slide === activeSlide);
      outlineItems.set(slide, item);
      outlineList.append(item);
    });
    if (!outlineItems.size) {
      const empty = doc.createElement('div');
      empty.className = 'preview-pptx-outline-empty';
      empty.textContent = labels.outlineEmpty;
      outlineList.append(empty);
    }
    outlineList.dataset.state = 'ready';
    if (!userChoseMode) setMode(outlineItems.size ? 'outline' : 'pages');
  };

  const frameOf = (slide: number): HTMLElement => ensureItem(slide).querySelector<HTMLElement>('.preview-pptx-thumb-frame')!;

  const showBitmap = (slide: number, url: string, width: number): void => {
    const image = doc.createElement('img');
    image.className = 'preview-pptx-thumb-image';
    image.alt = '';
    image.decoding = 'async';
    image.src = url;
    frameOf(slide).replaceChildren(image);
    const previous = objectUrls.get(slide);
    if (previous) win.URL.revokeObjectURL(previous);
    objectUrls.set(slide, url);
    captured.set(slide, width);
  };

  /** Fallback when a slide cannot be rasterized: a scaled DOM clone (heavier, but always faithful). */
  const showClone = (slide: number, source: HTMLElement, width: number, height: number): void => {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('video, audio, iframe, script').forEach(node => node.remove());
    const sourceCanvases = source.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((canvas, index) => {
      try {
        canvas.getContext('2d')?.drawImage(sourceCanvases[index], 0, 0);
      } catch {
        // Tainted or zero-sized chart canvases stay blank in the thumbnail.
      }
    });
    const stage = doc.createElement('div');
    stage.className = 'flyfish-pptx-content preview-pptx-thumb-stage';
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.append(clone);
    frameOf(slide).replaceChildren(stage);
    const previous = objectUrls.get(slide);
    if (previous) win.URL.revokeObjectURL(previous);
    objectUrls.delete(slide);
    captured.set(slide, Number.POSITIVE_INFINITY);
  };

  /**
   * Captures a mounted slide. The markup is read synchronously (the caller may unmount the slide
   * right after); only the bitmap encoding is asynchronous.
   */
  const capture = (slot: HTMLElement): Promise<boolean> | false => {
    const slide = Number(slot.dataset.slideNumber);
    const source = slot.querySelector<HTMLElement>(':scope > .slide');
    if (!slide || !source) return false;
    const width = parseFloat(source.style.width) || source.offsetWidth;
    const height = parseFloat(source.style.height) || source.offsetHeight;
    if (!width || !height) return false;
    if (!captured.size && !objectUrls.size) {
      slideWidth = width;
      nav.style.setProperty('--pptx-thumb-ratio', `${width} / ${height}`);
    }
    const frameWidth = frameOf(slide).clientWidth || thumbList.clientWidth || 160;
    const prepared = prepareSlide(source, width, height, thumbnailPixelScale(win, width, frameWidth));
    if (!prepared) {
      showClone(slide, source, width, height);
      layout();
      return Promise.resolve(true);
    }
    // Keep a clone only until the bitmap is ready, in case encoding fails.
    const fallback = source.cloneNode(true) as HTMLElement;
    return rasterizer(prepared, frameWidth, doc).then((url) => {
      if (disposed) {
        if (url) win.URL.revokeObjectURL(url);
        return false;
      }
      if (url) showBitmap(slide, url, frameWidth);
      else showClone(slide, fallback, width, height);
      layout();
      return true;
    });
  };

  /** The rail does capture work only while its Pages list is actually on screen. */
  const railActive = (): boolean => mode === 'pages' && !nav.hidden && nav.isConnected
    && win.getComputedStyle(nav).display !== 'none';

  const nextWanted = (): number | undefined => {
    const mountable = (slide: number): boolean => !!materializer || !!slotOf(slide)?.querySelector(':scope > .slide');
    const pending = (slide: number): boolean => !captured.has(slide) && !encoding.has(slide) && (attempts.get(slide) ?? 0) < MAX_CAPTURE_ATTEMPTS && mountable(slide);
    // Without IntersectionObserver every slide counts as visible.
    const wanted = (thumbObserver ? [...visibleSlides] : [...items.keys()]).filter(pending);
    if (wanted.length < 2) return wanted[0];
    // Thumbnails on screen first, then the prefetch margin nearest the view.
    const view = thumbList.getBoundingClientRect();
    const distance = (slide: number): number => {
      const rect = items.get(slide)!.getBoundingClientRect();
      return rect.bottom < view.top ? view.top - rect.bottom : rect.top > view.bottom ? rect.top - view.bottom : 0;
    };
    return wanted.map(slide => ({ slide, gap: distance(slide) })).sort((a, b) => a.gap - b.gap || a.slide - b.slide)[0].slide;
  };

  const schedulePump = (delay: number): void => {
    pumpTimer = win.setTimeout(() => {
      pumpTimer = 0;
      pump();
    }, delay);
  };

  /** Captures one missing thumbnail at a time while the rail is visible, nearest the view first. */
  function pump(): void {
    if (disposed || pumpTimer || encoding.size >= MAX_ENCODING || !railActive()) return;
    const slide = nextWanted();
    const slot = slide === undefined ? null : slotOf(slide);
    if (slide === undefined || !slot) return;
    attempts.set(slide, (attempts.get(slide) ?? 0) + 1);
    const deck = materializer;
    const mounted = !!slot.querySelector(':scope > .slide');
    const forced = !mounted && !!deck?.render(slide);
    if (!mounted && !forced) {
      // The deck viewer is not reachable: from now on only slides the deck mounts itself are captured.
      materializer = undefined;
      attempts.delete(slide);
      schedulePump(CAPTURE_GAP_MS);
      return;
    }
    const run = (): void => {
      const current = slotOf(slide);
      const pending = current ? capture(current) : false;
      if (forced) deck!.release();
      if (!pending) {
        schedulePump(CAPTURE_GAP_MS);
        return;
      }
      // The slide is already serialized and released; encode while the next slide mounts.
      encoding.add(slide);
      void pending.finally(() => {
        encoding.delete(slide);
        pump();
      });
      schedulePump(CAPTURE_GAP_MS);
    };
    // Freshly mounted slides hydrate media and charts first.
    if (forced) {
      pumpTimer = win.setTimeout(() => {
        pumpTimer = 0;
        run();
      }, CAPTURE_DELAY_MS);
    } else {
      run();
    }
  }

  const thumbObserver = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver((entries) => {
        for (const entry of entries) {
          const slide = Number((entry.target as HTMLElement).dataset.slide);
          if (entry.isIntersecting) visibleSlides.add(slide);
          else visibleSlides.delete(slide);
        }
        pump();
      }, { root: thumbList, rootMargin: PREFETCH_MARGIN })
    : null;

  /** Slides the deck mounts itself are captured right away when their thumbnail is wanted. */
  const slotObserver = new MutationObserver(() => pump());
  const syncSlots = (): void => {
    for (const slot of Array.from(content.querySelectorAll<HTMLElement>(`:scope > ${SLOT_SELECTOR}`))) {
      const slide = Number(slot.dataset.slideNumber);
      if (!slide || items.has(slide)) continue;
      ensureItem(slide);
      slotObserver.observe(slot, { childList: true });
    }
    layout();
    updateActive();
    pump();
  };
  const contentObserver = new MutationObserver(syncSlots);
  contentObserver.observe(content, { childList: true });

  const setActive = (slide: number): void => {
    if (slide === activeSlide) return;
    for (const map of [items, outlineItems]) {
      const previous = map.get(activeSlide);
      previous?.classList.remove('is-active');
      previous?.removeAttribute('aria-current');
      const next = map.get(slide);
      next?.classList.add('is-active');
      next?.setAttribute('aria-current', 'true');
    }
    activeSlide = slide;
    revealActive();
  };

  function updateActive(): void {
    scrollFrame = 0;
    const view = scroller!.getBoundingClientRect();
    const probe = view.top + view.height * 0.4;
    for (const slot of Array.from(content.querySelectorAll<HTMLElement>(`:scope > ${SLOT_SELECTOR}`))) {
      const rect = slot.getBoundingClientRect();
      if (rect.bottom >= probe) {
        setActive(Number(slot.dataset.slideNumber));
        return;
      }
    }
  }
  const onScroll = (): void => {
    if (!scrollFrame) scrollFrame = win.requestAnimationFrame(updateActive);
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const tab = target.closest<HTMLButtonElement>('.preview-pptx-tabs button');
    if (tab) {
      userChoseMode = true;
      setMode(tab.dataset.mode as PptxNavMode);
      return;
    }
    const item = target.closest<HTMLButtonElement>('.preview-pptx-thumb, .preview-pptx-outline-item');
    const slot = item && slotOf(Number(item.dataset.slide));
    if (!slot) return;
    scroller.scrollTop += slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    setActive(Number(item.dataset.slide));
  };

  const resize = new ResizeObserver(layout);
  resize.observe(shell);
  resize.observe(scroller);
  resize.observe(nav);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  nav.addEventListener('click', onClick);
  setMode('outline');
  syncSlots();
  titles.then(
    slideTitles => { if (!disposed) renderOutline(slideTitles); },
    () => { if (!disposed) renderOutline([]); },
  );

  return () => {
    disposed = true;
    contentObserver.disconnect();
    slotObserver.disconnect();
    thumbObserver?.disconnect();
    resize.disconnect();
    if (pumpTimer) win.clearTimeout(pumpTimer);
    objectUrls.forEach(url => win.URL.revokeObjectURL(url));
    objectUrls.clear();
    if (scrollFrame) win.cancelAnimationFrame(scrollFrame);
    scroller.removeEventListener('scroll', onScroll);
    shell.classList.remove('has-pptx-thumbs');
    nav.remove();
  };
}
