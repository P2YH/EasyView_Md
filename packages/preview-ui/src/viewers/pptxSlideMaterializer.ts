/**
 * The windowed @file-viewer/pptx renderer only mounts the slides near the main viewport and
 * keeps the parsed slide markup private. The thumbnail rail needs every slide once, so the
 * viewer class is wrapped (before any deck opens) to remember which viewer owns each
 * `.flyfish-pptx-content` element. The rail then asks that viewer to mount a slide briefly,
 * clones it, and lets the normal windowing unmount it again.
 */

/** The public `ensureSlideRendered` plus the private window refresh used to release slides. */
interface PptxViewerLike {
  readonly content: HTMLElement;
  ensureSlideRendered(slideNumber: number): Element | null;
  scheduleSlideWindowUpdate?: () => void;
}

interface PptxViewerClassLike {
  prototype: { open(this: PptxViewerLike, ...args: unknown[]): Promise<void> };
}

export interface PptxSlideMaterializer {
  /** Mounts the slide in its slot if the deck has not; returns false when unavailable. */
  render(slide: number): boolean;
  /** Lets the renderer unmount slides that are outside its window again. */
  release(): void;
}

const PATCHED = Symbol.for('easyview.pptxViewerRegistry');
const viewers = new WeakMap<HTMLElement, PptxViewerLike>();

export function registerPptxViewerClass(viewerClass: PptxViewerClassLike): void {
  const proto = viewerClass.prototype as PptxViewerClassLike['prototype'] & { [PATCHED]?: true };
  if (proto[PATCHED]) return;
  const open = proto.open;
  proto.open = function patchedOpen(this: PptxViewerLike, ...args: unknown[]): Promise<void> {
    if (this.content) viewers.set(this.content, this);
    return open.apply(this, args);
  };
  proto[PATCHED] = true;
}

let installing: Promise<void> | null = null;

/** Wraps the shared PptxViewer class once; safe to call repeatedly. Failures leave lazy capture only. */
export function installPptxViewerRegistry(): Promise<void> {
  installing ??= import('@file-viewer/pptx')
    .then(module => registerPptxViewerClass(module.PptxViewer as unknown as PptxViewerClassLike))
    .catch(() => undefined);
  return installing;
}

export function pptxSlideMaterializer(content: HTMLElement): PptxSlideMaterializer {
  return {
    render(slide) {
      const viewer = viewers.get(content);
      if (!viewer) return false;
      try {
        return viewer.ensureSlideRendered(slide) !== null;
      } catch {
        return false;
      }
    },
    release() {
      viewers.get(content)?.scheduleSlideWindowUpdate?.();
    },
  };
}
