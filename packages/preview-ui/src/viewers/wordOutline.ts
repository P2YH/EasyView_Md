// i18n-ignore-file: Chinese heading-numbering parse rules, not UI text.
/**
 * Word outline model shared by the editable .docx route and the read-only .doc/.docm route.
 * Everything here is pure so it can be unit tested without a renderer.
 */

export interface WordOutlineHeading {
  /** 1-based outline level after normalisation. */
  level: number;
  text: string;
  /** True when the level was guessed from numbering or formatting instead of a heading style. */
  inferred: boolean;
  /** Position of the source paragraph in the sample list. */
  index: number;
}

/** One paragraph as seen by the outline collector, whatever the renderer. */
export interface WordParagraphSample {
  text: string;
  /** 0-based outline level from a heading style or w:outlineLvl; null for body text. */
  styleLevel: number | null;
  /** Every non-blank run is bold. */
  bold: boolean;
  /** Dominant font size in points; null when unknown. */
  fontSize: number | null;
  /** Paragraph sits in a table, header, text box or list; never treated as an inferred heading. */
  excluded?: boolean;
}

export interface WordOutlineNode {
  heading: WordOutlineHeading;
  /** Position in the heading list. */
  id: number;
  depth: number;
  parent: number | null;
  children: number[];
}

export interface WordOutlineRow {
  node: WordOutlineNode;
  hasChildren: boolean;
  expanded: boolean;
}

const MAX_LEVEL = 9;
const DISPLAY_TEXT_LIMIT = 200;

export function normalizeHeadingText(text: string): string {
  const clean = text.replace(/[\s\u00a0\u3000]+/g, ' ').trim();
  return clean.length > DISPLAY_TEXT_LIMIT ? `${clean.slice(0, DISPLAY_TEXT_LIMIT)}…` : clean;
}

/**
 * Heading level (0-based) from a style id, style name or the slug the .doc renderer puts in
 * `msdoc-style-*`: "Heading1", "heading 2", "heading-3", "标题 1", "标题-2", "h4".
 */
export function headingLevelFromStyleName(name: string | null | undefined): number | null {
  if (!name) return null;
  const value = name.trim().toLowerCase();
  const match = /^(?:heading|标题|titre|überschrift|ueberschrift|título|titulo|h)[\s_-]*(\d)$/.exec(value);
  if (!match) return null;
  const level = Number(match[1]) - 1;
  return level >= 0 && level < MAX_LEVEL ? level : null;
}

const CN_NUM = '[一二三四五六七八九十百千零〇两\\d]+';
type NumberKind = 'part' | 'chapter' | 'section' | 'cn-enum' | 'cn-paren' | `decimal-${number}` | 'article';

/** Recognises common Chinese and decimal heading numbering. Returns the numbering family. */
export function headingNumberKind(text: string): NumberKind | null {
  if (new RegExp(`^第${CN_NUM}[篇部]`).test(text)) return 'part';
  if (new RegExp(`^第${CN_NUM}章`).test(text)) return 'chapter';
  if (new RegExp(`^第${CN_NUM}节`).test(text)) return 'section';
  if (new RegExp(`^第${CN_NUM}条`).test(text)) return 'article';
  if (/^[一二三四五六七八九十]{1,3}\s*[、．.]/.test(text)) return 'cn-enum';
  if (/^[（(][一二三四五六七八九十]{1,3}[)）]/.test(text)) return 'cn-paren';
  const decimal = /^(\d{1,2}(?:[.．]\d{1,2}){1,4})(?![.．]?\d)[.．]?\s*\S/.exec(text);
  if (decimal) return `decimal-${decimal[1].split(/[.．]/).length}`;
  if (/^\d{1,2}\s+\S/.test(text)) return 'decimal-1';
  if (/^(chapter|part|section|appendix)\s+[\dIVXLC]+\b/i.test(text)) return 'chapter';
  return null;
}

const SENTENCE_END = /[。；;，,：:！!？?、]$/;
/** Table-of-contents lines end with a leader or tab and a page number. */
const TOC_ENTRY = /(?:\t|\.{2,}|…+|·{2,})\s*\d+\s*$/;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface Candidate {
  index: number;
  text: string;
  kind: string;
}

/**
 * Guesses headings for documents that never use heading styles. Only short paragraphs qualify,
 * and they need either recognised numbering or bold text clearly larger than the body. Levels
 * follow the order in which each numbering family or font size first appears, which matches how
 * such documents are usually written (title, 第一章, 一、, 1.1 …).
 */
export function inferWordHeadings(samples: readonly WordParagraphSample[]): WordOutlineHeading[] {
  const bodySizes = samples
    .filter(sample => !sample.excluded && sample.fontSize && sample.text.trim().length >= 20)
    .map(sample => sample.fontSize as number);
  const body = median(bodySizes) ?? median(samples.filter(s => s.fontSize).map(s => s.fontSize as number));

  const candidates: Candidate[] = [];
  samples.forEach((sample, index) => {
    if (sample.excluded || TOC_ENTRY.test(sample.text)) return;
    const text = normalizeHeadingText(sample.text);
    if (!text || text.length > 60 || SENTENCE_END.test(text)) return;
    const larger = body != null && sample.fontSize != null && sample.fontSize >= body * 1.15 && sample.fontSize - body >= 1.5;
    const numbered = headingNumberKind(text);
    if (numbered) {
      // Plain "1 xxx" / "1.1 xxx" lines without emphasis are often list items; keep them short.
      const emphasised = sample.bold || larger;
      if (!emphasised && (text.length > 30 || numbered === 'decimal-1')) return;
      candidates.push({ index, text, kind: numbered });
      return;
    }
    if (sample.bold && larger && text.length <= 40) {
      candidates.push({ index, text, kind: `size-${Math.round((sample.fontSize as number) * 2)}` });
    }
  });

  // A numbering family that mostly appears on consecutive paragraphs is a list, not headings.
  const byKind = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byKind.get(candidate.kind) ?? [];
    list.push(candidate);
    byKind.set(candidate.kind, list);
  }
  const rejected = new Set<string>();
  for (const [kind, list] of byKind) {
    if (kind.startsWith('size-') || list.length < 3) continue;
    let adjacent = 0;
    for (let i = 1; i < list.length; i++) if (list[i].index === list[i - 1].index + 1) adjacent++;
    if (adjacent / (list.length - 1) > 0.6) rejected.add(kind);
  }
  const kept = candidates.filter(candidate => !rejected.has(candidate.kind));
  // Too many guesses means the heuristics do not fit this document; show nothing instead.
  if (kept.length < 2 || kept.length > Math.max(40, samples.length * 0.35)) return [];

  const order = rankKinds(kept);
  return kept.map(candidate => ({
    level: Math.min(MAX_LEVEL, (order.get(candidate.kind) ?? 0) + 1),
    text: candidate.text,
    inferred: true,
    index: candidate.index,
  }));
}

function rankKinds(candidates: readonly Candidate[]): Map<string, number> {
  const seen: string[] = [];
  for (const candidate of candidates) if (!seen.includes(candidate.kind)) seen.push(candidate.kind);
  // Decimal depth and size are ordered among themselves regardless of first appearance.
  const decimals = seen.filter(k => k.startsWith('decimal-')).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  const sizes = seen.filter(k => k.startsWith('size-')).sort((a, b) => Number(b.slice(5)) - Number(a.slice(5)));
  let d = 0;
  let s = 0;
  const ordered = seen.map(kind => (kind.startsWith('decimal-') ? decimals[d++] : kind.startsWith('size-') ? sizes[s++] : kind));
  return new Map(ordered.map((kind, rank) => [kind, rank]));
}

/** Styled headings when the document has any; otherwise the inferred fallback. */
export function extractWordHeadings(samples: readonly WordParagraphSample[]): WordOutlineHeading[] {
  const styled: WordOutlineHeading[] = [];
  samples.forEach((sample, index) => {
    if (sample.styleLevel == null || sample.styleLevel < 0 || sample.styleLevel >= MAX_LEVEL) return;
    const text = normalizeHeadingText(sample.text);
    if (!text) return;
    styled.push({ level: sample.styleLevel + 1, text, inferred: false, index });
  });
  if (styled.length) return styled;
  return inferWordHeadings(samples);
}

/** Nests headings by level; a level jump (1 → 3) nests directly under the nearest shallower heading. */
export function buildWordOutlineTree(headings: readonly WordOutlineHeading[]): WordOutlineNode[] {
  const nodes: WordOutlineNode[] = [];
  const stack: number[] = [];
  headings.forEach((heading, id) => {
    while (stack.length && nodes[stack[stack.length - 1]].heading.level >= heading.level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    const node: WordOutlineNode = { heading, id, depth: stack.length, parent, children: [] };
    nodes.push(node);
    if (parent != null) nodes[parent].children.push(id);
    stack.push(id);
  });
  return nodes;
}

/** Ids of nodes collapsed by default so the outline opens two levels deep. */
export function defaultCollapsed(nodes: readonly WordOutlineNode[], visibleDepth = 2): Set<number> {
  return new Set(nodes.filter(node => node.children.length && node.depth >= visibleDepth - 1).map(node => node.id));
}

export function visibleWordOutlineRows(nodes: readonly WordOutlineNode[], collapsed: ReadonlySet<number>): WordOutlineRow[] {
  const rows: WordOutlineRow[] = [];
  const hiddenUnder: number[] = [];
  for (const node of nodes) {
    while (hiddenUnder.length && !isDescendant(nodes, node, hiddenUnder[hiddenUnder.length - 1])) hiddenUnder.pop();
    if (hiddenUnder.length) continue;
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.id);
    rows.push({ node, hasChildren, expanded });
    if (hasChildren && !expanded) hiddenUnder.push(node.id);
  }
  return rows;
}

function isDescendant(nodes: readonly WordOutlineNode[], node: WordOutlineNode, ancestor: number): boolean {
  let parent = node.parent;
  while (parent != null) {
    if (parent === ancestor) return true;
    parent = nodes[parent].parent;
  }
  return false;
}

/** Nearest ancestor (or the node itself) that is currently visible in the tree. */
export function visibleAncestor(nodes: readonly WordOutlineNode[], collapsed: ReadonlySet<number>, id: number): number {
  let visible = id;
  let parent = nodes[id]?.parent ?? null;
  while (parent != null) {
    if (collapsed.has(parent)) visible = parent;
    parent = nodes[parent].parent;
  }
  return visible;
}

/**
 * Index of the section containing `offset`: the last heading whose top is at or above it.
 * `tops` must be ascending; null entries (not laid out yet) are skipped. Returns -1 above the first.
 */
export function findActiveHeading(tops: ReadonlyArray<number | null>, offset: number): number {
  const known: number[] = [];
  tops.forEach((top, index) => { if (top != null) known.push(index); });
  let lo = 0;
  let hi = known.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((tops[known[mid]] as number) <= offset) {
      found = known[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Leading + trailing throttle; the trailing call always runs with the latest state. */
export function throttle(fn: () => void, ms: number, win: Pick<Window, 'setTimeout' | 'clearTimeout'> = window): { (): void; cancel(): void } {
  let last = 0;
  let timer: number | null = null;
  const run = (): void => {
    timer = null;
    last = Date.now();
    fn();
  };
  const throttled = (): void => {
    const wait = ms - (Date.now() - last);
    if (wait <= 0 && !timer) run();
    else if (!timer) timer = win.setTimeout(run, Math.max(0, wait));
  };
  throttled.cancel = (): void => {
    if (timer) win.clearTimeout(timer);
    timer = null;
  };
  return throttled;
}

/* ---------- OOXML reader (for .docm / .dotm rendered read-only) ---------- */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttribute(`w:${name}`) ?? el.getAttributeNS(W_NS, name);
}

/** Element name without the `w:` prefix; parsers differ on whether localName keeps it. */
function wName(el: Element): string {
  const name = el.localName || el.nodeName;
  const colon = name.indexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function wChild(el: Element, name: string): Element | null {
  for (const child of Array.from(el.children)) if (wName(child) === name) return child;
  return null;
}

function wDescendants(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter(child => wName(child) === name);
}

/** Style id → 0-based outline level, following basedOn chains. */
export function readStyleOutlineLevels(stylesXml: string, parser: DOMParser = new DOMParser()): Map<string, number> {
  const doc = parser.parseFromString(stylesXml, 'application/xml');
  const own = new Map<string, { level: number | null; basedOn: string | null }>();
  for (const style of wDescendants(doc, 'style')) {
    if (wAttr(style, 'type') !== 'paragraph') continue;
    const id = wAttr(style, 'styleId');
    if (!id) continue;
    const pPr = wChild(style, 'pPr');
    const lvlEl = pPr ? wChild(pPr, 'outlineLvl') : null;
    const raw = lvlEl ? Number(wAttr(lvlEl, 'val')) : NaN;
    const name = wAttr(wChild(style, 'name'), 'val');
    const level = Number.isFinite(raw) ? raw : headingLevelFromStyleName(name) ?? headingLevelFromStyleName(id);
    own.set(id, { level, basedOn: wAttr(wChild(style, 'basedOn'), 'val') });
  }
  const resolved = new Map<string, number>();
  for (const id of own.keys()) {
    let current: string | null = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const entry = own.get(current);
      if (!entry) break;
      if (entry.level != null) {
        if (entry.level >= 0 && entry.level < MAX_LEVEL) resolved.set(id, entry.level);
        break;
      }
      current = entry.basedOn;
    }
  }
  return resolved;
}

/** Body paragraphs of document.xml as outline samples (tables excluded). */
export function readDocxParagraphSamples(documentXml: string, styleLevels: ReadonlyMap<string, number>, parser: DOMParser = new DOMParser()): WordParagraphSample[] {
  const doc = parser.parseFromString(documentXml, 'application/xml');
  const body = wDescendants(doc, 'body')[0];
  if (!body) return [];
  const samples: WordParagraphSample[] = [];
  for (const p of wDescendants(body, 'p')) {
    let ancestor = p.parentElement;
    let excluded = false;
    while (ancestor && ancestor !== body) {
      if (wName(ancestor) === 'tbl' || wName(ancestor) === 'txbxContent') excluded = true;
      ancestor = ancestor.parentElement;
    }
    const pPr = wChild(p, 'pPr');
    const direct = pPr ? wChild(pPr, 'outlineLvl') : null;
    const styleId = wAttr(pPr ? wChild(pPr, 'pStyle') : null, 'val');
    const directLevel = direct ? Number(wAttr(direct, 'val')) : NaN;
    let styleLevel: number | null = Number.isFinite(directLevel) ? directLevel : styleId ? styleLevels.get(styleId) ?? headingLevelFromStyleName(styleId) : null;
    if (styleLevel != null && (styleLevel < 0 || styleLevel >= MAX_LEVEL)) styleLevel = null;
    let text = '';
    let bold = true;
    let sawText = false;
    let size: number | null = null;
    for (const run of wDescendants(p, 'r')) {
      const runText = wDescendants(run, 't').map(t => t.textContent ?? '').join('');
      if (!runText) continue;
      text += runText;
      if (!runText.trim()) continue;
      sawText = true;
      const rPr = wChild(run, 'rPr');
      const b = rPr ? wChild(rPr, 'b') : null;
      if (!b || wAttr(b, 'val') === '0' || wAttr(b, 'val') === 'false') bold = false;
      const sz = rPr ? wChild(rPr, 'sz') : null;
      if (sz && size == null) size = Number(wAttr(sz, 'val')) / 2 || null;
    }
    samples.push({ text, styleLevel, bold: sawText && bold, fontSize: size, excluded });
  }
  return samples;
}
