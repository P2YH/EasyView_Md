/**
 * Turns a mounted PPTX slide into a small bitmap for the thumbnail rail, so the rail keeps one
 * image per slide instead of a full cloned DOM tree (slides carry hundreds of nodes and inline
 * base64 pictures).
 *
 * The slide markup is serialized into an SVG `<foreignObject>` together with the deck's scoped
 * `.flyfish-pptx-content` CSS, drawn onto a canvas sized to the thumbnail frame (device-pixel
 * aware) and encoded as a WebP blob URL. This works because the engine inlines pictures as
 * `data:` URLs and text uses system fonts, so the SVG image needs no external resources and the
 * canvas stays untainted. Web fonts and remote URLs cannot load inside an SVG image; if encoding
 * fails the caller falls back to a DOM clone for that slide.
 */

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const DECK_CSS_PATTERN = /flyfish-pptx/;

export interface PreparedSlide {
  /** Serialized XHTML markup, ready for a `<foreignObject>`. */
  markup: string;
  width: number;
  height: number;
}

/** Bitmap encoder; returns an object URL or null when the slide cannot be rasterized. */
export type SlideRasterizer = (slide: PreparedSlide, targetWidth: number, doc: Document) => Promise<string | null>;

let cssCache: { key: string; css: string } | null = null;

/** Collects the deck stylesheets (engine base styles plus the per-deck `._css_N` rules). */
function deckCss(root: Document | ShadowRoot): string {
  const styles = Array.from(root.querySelectorAll('style')).filter(style => DECK_CSS_PATTERN.test(style.textContent ?? ''));
  const key = styles.map(style => (style.textContent ?? '').length).join(',');
  if (cssCache?.key === key) return cssCache.css;
  const css = styles.map(style => style.textContent ?? '').join('\n').replace(/]]>/g, ']]\\>');
  cssCache = { key, css };
  return css;
}

/** Device pixels per slide pixel for a thumbnail `targetWidth` CSS pixels wide. */
export function thumbnailPixelScale(view: Window, slideWidth: number, targetWidth: number): number {
  return Math.min(2, Math.max(1, view.devicePixelRatio || 1)) * targetWidth / slideWidth;
}

/**
 * Re-encodes a decoded picture or chart at roughly the size it covers in the thumbnail, so the
 * SVG stays small and the browser never decodes full-resolution slide pictures for a thumbnail.
 */
function downscaled(doc: Document, source: CanvasImageSource, box: HTMLElement, pixelScale: number): string | null {
  const width = Math.max(1, Math.ceil((box.offsetWidth || parseFloat(box.style.width) || 1) * pixelScale));
  const height = Math.max(1, Math.ceil((box.offsetHeight || parseFloat(box.style.height) || 1) * pixelScale));
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    // Tainted or zero-sized sources keep their original markup.
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Serializes a mounted slide synchronously so the caller can release (unmount) it right away.
 * Pictures and chart canvases are re-encoded at thumbnail size; media elements are dropped.
 */
export function prepareSlide(source: HTMLElement, width: number, height: number, pixelScale = 0.25): PreparedSlide | null {
  const doc = source.ownerDocument;
  const view = doc.defaultView;
  if (!view || typeof view.XMLSerializer !== 'function') return null;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('video, audio, iframe, script').forEach(node => node.remove());
  const sourceImages = Array.from(source.querySelectorAll('img'));
  Array.from(clone.querySelectorAll('img')).forEach((image, index) => {
    const original = sourceImages[index];
    if (!original?.complete || !original.naturalWidth) return;
    const url = downscaled(doc, original, original, pixelScale);
    if (url) {
      image.src = url;
      image.removeAttribute('srcset');
    }
  });
  const sourceCanvases = Array.from(source.querySelectorAll('canvas'));
  Array.from(clone.querySelectorAll('canvas')).forEach((canvas, index) => {
    const image = doc.createElement('img');
    image.style.cssText = canvas.style.cssText;
    image.className = canvas.className;
    const url = sourceCanvases[index] ? downscaled(doc, sourceCanvases[index], sourceCanvases[index], pixelScale) : null;
    if (url) image.src = url;
    canvas.replaceWith(image);
  });
  const root = source.getRootNode() as Document | ShadowRoot;
  const wrapper = doc.createElement('div');
  wrapper.className = 'flyfish-pptx-content';
  wrapper.style.cssText = `position:relative;margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;`;
  const style = doc.createElement('style');
  wrapper.append(style, clone);
  const css = deckCss(root);
  const serialized = new view.XMLSerializer().serializeToString(wrapper);
  const withCss = serialized.replace('<style></style>', `<style><![CDATA[\n${css}\n]]></style>`);
  return { markup: withCss.includes(`xmlns="${XHTML_NS}"`) ? withCss : withCss.replace('<div', `<div xmlns="${XHTML_NS}"`), width, height };
}

/** Default encoder: SVG foreignObject → canvas at the frame size → WebP object URL. */
export const rasterizeSlide: SlideRasterizer = async (slide, targetWidth, doc) => {
  const view = doc.defaultView;
  if (!view) return null;
  const pixelWidth = Math.max(1, Math.round(slide.width * thumbnailPixelScale(view, slide.width, targetWidth)));
  const pixelHeight = Math.max(1, Math.round(pixelWidth * slide.height / slide.width));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${slide.width} ${slide.height}">`
    + `<foreignObject x="0" y="0" width="${slide.width}" height="${slide.height}">${slide.markup}</foreignObject></svg>`;
  try {
    const image = new view.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('slide svg failed to load'));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = doc.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
    return blob ? view.URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
};
