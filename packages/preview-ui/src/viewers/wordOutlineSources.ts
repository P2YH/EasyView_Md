import JSZip from 'jszip';
import {
  extractWordHeadings,
  headingLevelFromStyleName,
  normalizeHeadingText,
  readDocxParagraphSamples,
  readStyleOutlineLevels,
  type WordOutlineHeading,
  type WordParagraphSample,
} from './wordOutline';
import type { WordOutlineSource } from './wordOutlinePane';

const REVEAL_MARGIN = 12;

function topIn(scroller: HTMLElement, el: Element): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

function revealAt(scroller: HTMLElement | null, top: number | null): boolean {
  if (!scroller || top == null) return false;
  scroller.scrollTo({ top: Math.max(0, top - REVEAL_MARGIN), behavior: 'auto' });
  return true;
}

/* ---------- Editable .docx (DocxEditor / ProseMirror) ---------- */

interface PmNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
  isText?: boolean;
  text?: string | null;
  textContent: string;
  marks?: ReadonlyArray<{ type: { name: string }; attrs: Record<string, unknown> }>;
  forEach(fn: (child: PmNodeLike, offset: number) => void): void;
  descendants(fn: (node: PmNodeLike, pos: number, parent: PmNodeLike | null) => boolean | void): void;
}

interface LayoutLike {
  pages: ReadonlyArray<{ size: { w: number; h: number }; fragments: ReadonlyArray<{ y: number; pmStart?: number }> }>;
}

export interface DocxOutlineEditor {
  getEditorRef(): {
    getView(): { state: { doc: PmNodeLike } } | null;
    getLayout(): LayoutLike | null;
  } | null;
  scrollToPosition(pmPos: number): void;
}

/** Outline samples from a ProseMirror document produced by docx-editor; `positions[i]` is sample i's pos. */
export function samplesFromPmDoc(doc: PmNodeLike): { samples: WordParagraphSample[]; positions: number[] } {
  const samples: WordParagraphSample[] = [];
  const positions: number[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'paragraph') return true;
    const rawLevel = node.attrs.outlineLevel;
    let styleLevel = typeof rawLevel === 'number' ? rawLevel : null;
    if (styleLevel == null) styleLevel = headingLevelFromStyleName(typeof node.attrs.styleId === 'string' ? node.attrs.styleId : null);
    let bold = true;
    let sawText = false;
    let fontSize: number | null = null;
    node.forEach((child) => {
      if (!child.isText || !(child.text ?? '').trim()) return;
      sawText = true;
      const marks = child.marks ?? [];
      if (!marks.some(mark => mark.type.name === 'bold')) bold = false;
      if (fontSize == null) {
        const size = marks.find(mark => mark.type.name === 'fontSize')?.attrs.size;
        if (typeof size === 'number' && size > 0) fontSize = size / 2;
      }
    });
    samples.push({
      text: node.textContent,
      styleLevel,
      bold: sawText && bold,
      fontSize,
      excluded: !!parent && parent.type.name !== 'doc',
    });
    positions.push(pos);
    return false;
  });
  return { samples, positions };
}

/** Outline over the editable DocxEditor: headings from ProseMirror, geometry from the page layout. */
export function createDocxEditorOutlineSource(
  root: HTMLElement,
  getEditor: () => DocxOutlineEditor | null,
  subscribe: (onChange: () => void) => () => void,
): WordOutlineSource {
  let positions: number[] = [];
  const scroller = (): HTMLElement | null => root.querySelector<HTMLElement>('.docx-editor__scroll-container');

  const tops = (headings: readonly WordOutlineHeading[], scrollEl: HTMLElement): Array<number | null> => {
    const editorRef = getEditor()?.getEditorRef();
    const layout = editorRef?.getLayout() ?? null;
    const pageEls = Array.from(scrollEl.querySelectorAll<HTMLElement>('.layout-page'));
    const byPos = new Map<number, { page: number; y: number }>();
    if (layout && pageEls.length >= layout.pages.length) {
      layout.pages.forEach((page, pageIndex) => {
        for (const fragment of page.fragments) {
          if (fragment.pmStart != null && !byPos.has(fragment.pmStart)) byPos.set(fragment.pmStart, { page: pageIndex, y: fragment.y });
        }
      });
    }
    const pageTops = new Map<number, { top: number; scale: number }>();
    const pageTop = (index: number): { top: number; scale: number } | null => {
      const cached = pageTops.get(index);
      if (cached) return cached;
      const el = pageEls[index];
      const size = layout?.pages[index]?.size;
      if (!el || !size?.h) return null;
      const rect = el.getBoundingClientRect();
      const value = { top: topIn(scrollEl, el), scale: rect.height / size.h || 1 };
      pageTops.set(index, value);
      return value;
    };
    return headings.map((heading) => {
      const pos = positions[heading.index];
      if (pos == null) return null;
      const placed = byPos.get(pos);
      if (placed) {
        const page = pageTop(placed.page);
        if (page) return page.top + placed.y * page.scale;
      }
      const el = scrollEl.querySelector(`.layout-paragraph[data-pm-start="${pos}"]`);
      return el ? topIn(scrollEl, el) : null;
    });
  };

  return {
    collect() {
      const view = getEditor()?.getEditorRef()?.getView();
      if (!view) return null;
      const result = samplesFromPmDoc(view.state.doc);
      positions = result.positions;
      return extractWordHeadings(result.samples);
    },
    scroller,
    tops,
    reveal(heading, scrollEl) {
      const top = scrollEl ? tops([heading], scrollEl)[0] : null;
      if (revealAt(scrollEl, top)) return;
      const pos = positions[heading.index];
      if (pos != null) getEditor()?.scrollToPosition(pos + 1);
    },
    observe: subscribe,
  };
}

/* ---------- Read-only renderers (@file-viewer: .doc and .docm/.dotm) ---------- */

interface DomOutline {
  headings: WordOutlineHeading[];
  elements: Element[];
}

function createDomOutlineSource(root: HTMLElement, contentSelector: string, read: (content: Element) => DomOutline | null): WordOutlineSource {
  let elements: Element[] = [];
  const content = (): Element | null => root.querySelector(contentSelector);
  const scroller = (): HTMLElement | null => {
    const el = content();
    return (el?.closest<HTMLElement>('.file-render') ?? root.querySelector<HTMLElement>('.file-render')) || null;
  };
  return {
    collect() {
      const el = content();
      if (!el) return null;
      const result = read(el);
      if (!result) return null;
      elements = result.elements;
      return result.headings;
    },
    scroller,
    tops(headings, scrollEl) {
      return headings.map((heading) => {
        const el = elements[heading.index];
        return el && el.isConnected ? topIn(scrollEl, el) : null;
      });
    },
    reveal(heading, scrollEl) {
      const el = elements[heading.index];
      if (!el || !el.isConnected) return;
      if (!revealAt(scrollEl, scrollEl ? topIn(scrollEl, el) : null)) el.scrollIntoView({ block: 'start' });
    },
    observe(onChange) {
      // Re-renders (theme, zoom) replace the document root; ignore toolbar and page churn.
      let current = content();
      let count = current?.querySelectorAll('p').length ?? 0;
      const observer = new MutationObserver(() => {
        const next = content();
        const nextCount = next?.querySelectorAll('p').length ?? 0;
        if (next === current && nextCount === count) return;
        current = next;
        count = nextCount;
        onChange();
      });
      observer.observe(root, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  };
}

function textStyle(el: Element): { bold: boolean; fontSize: number | null } {
  const win = el.ownerDocument.defaultView;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let bold = true;
  let sawText = false;
  let fontSize: number | null = null;
  let checked = 0;
  for (let node = walker.nextNode(); node && checked < 24; node = walker.nextNode()) {
    if (!(node.nodeValue ?? '').trim() || !node.parentElement) continue;
    checked++;
    sawText = true;
    const style = win?.getComputedStyle(node.parentElement);
    const weight = style ? Number.parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400) : 400;
    if (weight < 600) bold = false;
    if (fontSize == null && style) {
      const px = Number.parseFloat(style.fontSize);
      if (px > 0) fontSize = Math.round(px * 0.75 * 2) / 2;
    }
  }
  return { bold: sawText && bold, fontSize };
}

/** `msdoc-style-heading-1`, `msdoc-style-标题-2`, … → 0-based level. */
export function msdocStyleLevel(el: Element): number | null {
  for (const name of Array.from(el.classList)) {
    if (!name.startsWith('msdoc-style-')) continue;
    const level = headingLevelFromStyleName(name.slice('msdoc-style-'.length));
    if (level != null) return level;
  }
  return null;
}

/** Legacy binary .doc rendered by @file-viewer/doc as `p.msdoc-paragraph` blocks. */
export function readMsdocOutline(content: Element): DomOutline {
  const paragraphs = Array.from(content.querySelectorAll('p.msdoc-paragraph'));
  const levels = paragraphs.map(msdocStyleLevel);
  // Formatting only feeds the inference fallback, so skip the style reads when headings are styled.
  const styled = levels.some(level => level != null);
  const samples: WordParagraphSample[] = paragraphs.map((p, i) => {
    const style = styled ? { bold: false, fontSize: null } : textStyle(p);
    return {
      text: p.textContent ?? '',
      styleLevel: levels[i],
      bold: style.bold,
      fontSize: style.fontSize,
      excluded: !!p.closest('table'),
    };
  });
  return { headings: extractWordHeadings(samples), elements: paragraphs };
}

export function createMsdocOutlineSource(root: HTMLElement): WordOutlineSource {
  return createDomOutlineSource(root, '.msdoc-root', content => readMsdocOutline(content));
}

/** Headings read straight from the OOXML package (used for .docm/.dotm, which open read-only). */
export async function readDocxPackageHeadings(data: ArrayBuffer): Promise<WordOutlineHeading[]> {
  const zip = await JSZip.loadAsync(data);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) return [];
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const levels = stylesXml ? readStyleOutlineLevels(stylesXml) : new Map<string, number>();
  return extractWordHeadings(readDocxParagraphSamples(documentXml, levels));
}

/** Pairs package headings with rendered paragraphs in document order by their text. */
export function matchHeadingsToParagraphs(headings: readonly WordOutlineHeading[], paragraphs: readonly Element[]): DomOutline {
  const elements: Element[] = [];
  const matched: WordOutlineHeading[] = [];
  let cursor = 0;
  for (const heading of headings) {
    for (let i = cursor; i < paragraphs.length; i++) {
      const text = normalizeHeadingText(paragraphs[i].textContent ?? '');
      if (text && (text === heading.text || text.startsWith(heading.text.replace(/…$/, '')))) {
        matched.push({ ...heading, index: matched.length });
        elements.push(paragraphs[i]);
        cursor = i + 1;
        break;
      }
    }
  }
  return { headings: matched, elements };
}

export function createDocxPreviewOutlineSource(root: HTMLElement, headings: Promise<WordOutlineHeading[]>): WordOutlineSource {
  let resolved: WordOutlineHeading[] | null = null;
  let failed = false;
  headings.then((value) => { resolved = value; }, () => { failed = true; resolved = []; });
  return createDomOutlineSource(root, '.docx-wrapper', (content) => {
    if (!resolved) return failed ? { headings: [], elements: [] } : null;
    const paragraphs = Array.from(content.querySelectorAll('section.docx p'));
    if (!paragraphs.length) return null;
    return matchHeadingsToParagraphs(resolved, paragraphs);
  });
}
