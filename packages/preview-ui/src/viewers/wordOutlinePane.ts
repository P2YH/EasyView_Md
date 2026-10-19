import {
  buildWordOutlineTree,
  defaultCollapsed,
  findActiveHeading,
  throttle,
  visibleAncestor,
  visibleWordOutlineRows,
  type WordOutlineHeading,
  type WordOutlineNode,
  type WordOutlineRow,
} from './wordOutline';
import { tPreview } from '../preview.i18n';

export interface WordOutlineLabels {
  title: string;
  empty: string;
  inferred: string;
  inferredHint: string;
  expand: string;
  collapse: string;
}

export function wordOutlineLabels(): WordOutlineLabels {
  return {
    title: tPreview('word.outline'),
    empty: tPreview('word.outlineEmpty'),
    inferred: tPreview('word.outlineInferred'),
    inferredHint: tPreview('word.outlineInferredHint'),
    expand: tPreview('word.outlineExpand'),
    collapse: tPreview('word.outlineCollapse'),
  };
}

/** Renderer-specific access to a Word document's headings and scroll geometry. */
export interface WordOutlineSource {
  /** Headings in document order, or null while the document is not laid out yet. */
  collect(): WordOutlineHeading[] | null;
  /** The element that scrolls the document. */
  scroller(): HTMLElement | null;
  /** Top of each heading in scroller content coordinates; null when it is not laid out. */
  tops(headings: readonly WordOutlineHeading[], scroller: HTMLElement): Array<number | null>;
  /** Scroll the document so the heading is at the top. */
  reveal(heading: WordOutlineHeading, scroller: HTMLElement | null): void;
  /** Subscribe to content changes (edits, re-renders). */
  observe(onChange: () => void): () => void;
}

export interface WordOutlineController {
  pane: HTMLElement;
  /** Re-collect headings now (otherwise debounced through `observe`). */
  refresh(): void;
  dispose(): void;
}

export const WORD_OUTLINE_ROW_HEIGHT = 26;
const OVERSCAN = 8;
const FALLBACK_VIEWPORT_ROWS = 60;
const REFRESH_DEBOUNCE_MS = 300;
/** Give a slow document about 30 s to lay out before showing the empty state. */
const MAX_RETRIES = 120;
const SCROLL_THROTTLE_MS = 80;
const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Left outline rail for Word documents. The list is virtualised with fixed-height rows so very
 * long documents (thousands of headings) keep a small DOM.
 */
export function installWordOutline(
  container: HTMLElement,
  source: WordOutlineSource,
  labels: WordOutlineLabels,
  options: { before?: Element | null } = {},
): WordOutlineController {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;

  const pane = doc.createElement('nav');
  pane.className = 'preview-word-outline';
  pane.dataset.state = 'loading';
  pane.setAttribute('aria-label', labels.title);
  const head = doc.createElement('div');
  head.className = 'preview-word-outline-head';
  const title = doc.createElement('span');
  title.className = 'preview-word-outline-title';
  title.textContent = labels.title;
  const badge = doc.createElement('span');
  badge.className = 'preview-word-outline-badge';
  badge.textContent = labels.inferred;
  badge.title = labels.inferredHint;
  badge.hidden = true;
  head.append(title, badge);
  const list = doc.createElement('div');
  list.className = 'preview-word-outline-list';
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', labels.title);
  const spacer = doc.createElement('div');
  spacer.className = 'preview-word-outline-spacer';
  list.append(spacer);
  const empty = doc.createElement('div');
  empty.className = 'preview-word-outline-empty';
  empty.textContent = labels.empty;
  pane.append(head, list, empty);
  container.insertBefore(pane, options.before ?? null);

  let headings: WordOutlineHeading[] = [];
  let signature = '';
  let nodes: WordOutlineNode[] = [];
  let collapsed = new Set<number>();
  let rows: WordOutlineRow[] = [];
  let activeId = -1;
  let pinnedUntil = 0;
  let tops: Array<number | null> | null = null;
  let scroller: HTMLElement | null = null;
  let disposed = false;
  let renderFrame = 0;
  let debounceTimer: number | null = null;
  let retryTimer: number | null = null;
  let retries = 0;
  const rendered = new Map<number, HTMLElement>();

  const rowIndexOf = (id: number): number => rows.findIndex(row => row.node.id === id);

  const renderRows = (): void => {
    renderFrame = 0;
    if (disposed) return;
    spacer.style.height = `${rows.length * WORD_OUTLINE_ROW_HEIGHT + 8}px`;
    const viewport = list.clientHeight || FALLBACK_VIEWPORT_ROWS * WORD_OUTLINE_ROW_HEIGHT;
    const first = Math.max(0, Math.floor(list.scrollTop / WORD_OUTLINE_ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((list.scrollTop + viewport) / WORD_OUTLINE_ROW_HEIGHT) + OVERSCAN);
    const highlighted = activeId >= 0 && nodes[activeId] ? visibleAncestor(nodes, collapsed, activeId) : -1;
    const keep = new Set<number>();
    for (let i = first; i < last; i++) {
      const row = rows[i];
      const id = row.node.id;
      keep.add(id);
      let el = rendered.get(id);
      if (!el) {
        el = createRow(row);
        rendered.set(id, el);
        list.append(el);
      }
      updateRow(el, row, i, id === highlighted);
    }
    for (const [id, el] of rendered) {
      if (!keep.has(id)) {
        el.remove();
        rendered.delete(id);
      }
    }
  };

  const scheduleRender = (): void => {
    if (!renderFrame) renderFrame = win.requestAnimationFrame(renderRows);
  };

  const createRow = (row: WordOutlineRow): HTMLElement => {
    const el = doc.createElement('div');
    el.className = 'preview-word-outline-item';
    el.setAttribute('role', 'treeitem');
    el.dataset.id = String(row.node.id);
    el.tabIndex = 0;
    const twisty = doc.createElement('button');
    twisty.type = 'button';
    twisty.className = 'preview-word-outline-twisty';
    twisty.tabIndex = -1;
    twisty.innerHTML = CHEVRON;
    const text = doc.createElement('span');
    text.className = 'preview-word-outline-text';
    el.append(twisty, text);
    return el;
  };

  const updateRow = (el: HTMLElement, row: WordOutlineRow, index: number, active: boolean): void => {
    const { heading, depth } = row.node;
    el.style.top = `${index * WORD_OUTLINE_ROW_HEIGHT}px`;
    el.style.paddingLeft = `${4 + depth * 12}px`;
    el.setAttribute('aria-level', String(depth + 1));
    el.dataset.level = String(heading.level);
    el.title = heading.text;
    el.classList.toggle('is-active', active);
    el.classList.toggle('is-inferred', heading.inferred);
    if (row.hasChildren) el.setAttribute('aria-expanded', String(row.expanded));
    else el.removeAttribute('aria-expanded');
    if (active) el.setAttribute('aria-current', 'location');
    else el.removeAttribute('aria-current');
    const twisty = el.firstElementChild as HTMLButtonElement;
    twisty.hidden = !row.hasChildren;
    twisty.classList.toggle('is-expanded', row.expanded);
    const toggleLabel = row.expanded ? labels.collapse : labels.expand;
    if (twisty.getAttribute('aria-label') !== toggleLabel) twisty.setAttribute('aria-label', toggleLabel);
    const text = el.lastElementChild as HTMLElement;
    if (text.textContent !== heading.text) text.textContent = heading.text;
  };

  const rebuildRows = (): void => {
    rows = visibleWordOutlineRows(nodes, collapsed);
    renderRows();
  };

  const scrollActiveIntoView = (): void => {
    if (activeId < 0 || !nodes[activeId]) return;
    const index = rowIndexOf(visibleAncestor(nodes, collapsed, activeId));
    if (index < 0 || !list.clientHeight) return;
    const top = index * WORD_OUTLINE_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - WORD_OUTLINE_ROW_HEIGHT);
    else if (top + WORD_OUTLINE_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight + WORD_OUTLINE_ROW_HEIGHT * 2;
    }
  };

  const setActive = (id: number): void => {
    if (id === activeId) return;
    activeId = id;
    scrollActiveIntoView();
    renderRows();
  };

  const updateActive = (): void => {
    if (disposed || !scroller || !headings.length || Date.now() < pinnedUntil) return;
    if (!tops) tops = source.tops(headings, scroller);
    const viewport = scroller.clientHeight;
    // At the very end the last sections may never reach the probe line; use the viewport bottom.
    const atEnd = viewport > 0 && scroller.scrollTop > 0 && scroller.scrollTop + viewport >= scroller.scrollHeight - 2;
    const probe = scroller.scrollTop + (atEnd ? viewport - 24 : Math.min(80, viewport * 0.2));
    const index = findActiveHeading(tops, probe);
    if (tops.every(top => top == null)) {
      // Nothing measured yet (layout pending); retry instead of caching an empty answer.
      tops = null;
      return;
    }
    setActive(index);
  };
  const onScroll = throttle(updateActive, SCROLL_THROTTLE_MS, win);

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        tops = null;
        onScroll();
        scheduleRender();
      })
    : null;
  resizeObserver?.observe(list);

  const bindScroller = (): void => {
    const next = source.scroller();
    if (next === scroller) return;
    if (scroller) {
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver?.unobserve(scroller);
      if (scroller.firstElementChild) resizeObserver?.unobserve(scroller.firstElementChild);
    }
    scroller = next;
    if (scroller) {
      scroller.addEventListener('scroll', onScroll, { passive: true });
      resizeObserver?.observe(scroller);
      if (scroller.firstElementChild) resizeObserver?.observe(scroller.firstElementChild);
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    if (debounceTimer) win.clearTimeout(debounceTimer);
    debounceTimer = null;
    bindScroller();
    const next = source.collect();
    if (next != null) retries = 0;
    if (next == null) {
      // Still loading: keep the empty message hidden and look again shortly.
      if (!headings.length) pane.dataset.state = retries < MAX_RETRIES ? 'loading' : 'empty';
      if (!retryTimer && retries < MAX_RETRIES) {
        retries++;
        retryTimer = win.setTimeout(() => { retryTimer = null; refresh(); }, 250);
      }
      return;
    }
    const nextSignature = next.map(h => `${h.level}\u0001${h.text}\u0001${h.inferred ? 1 : 0}`).join('\u0002');
    tops = null;
    if (nextSignature !== signature) {
      const previous = nodes;
      const previousCollapsed = collapsed;
      headings = next;
      signature = nextSignature;
      nodes = buildWordOutlineTree(headings);
      const sameShape = previous.length === nodes.length && previous.every((node, i) => node.heading.level === nodes[i].heading.level);
      collapsed = sameShape ? new Set([...previousCollapsed].filter(id => nodes[id]?.children.length)) : defaultCollapsed(nodes);
      if (!sameShape) activeId = -1;
      pane.dataset.state = headings.length ? 'ready' : 'empty';
      badge.hidden = !headings.some(h => h.inferred);
      rebuildRows();
    } else {
      headings = next;
      pane.dataset.state = headings.length ? 'ready' : 'empty';
    }
    updateActive();
  };

  const scheduleRefresh = (): void => {
    if (disposed) return;
    if (debounceTimer) win.clearTimeout(debounceTimer);
    debounceTimer = win.setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  };

  const toggle = (id: number): void => {
    if (!nodes[id]?.children.length) return;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    rebuildRows();
  };

  const onListClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const item = target?.closest<HTMLElement>('.preview-word-outline-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (target?.closest('.preview-word-outline-twisty')) {
      event.stopPropagation();
      toggle(id);
      return;
    }
    const heading = headings[id];
    if (!heading) return;
    bindScroller();
    source.reveal(heading, scroller);
    pinnedUntil = Date.now() + 600;
    activeId = id;
    renderRows();
    win.setTimeout(() => { pinnedUntil = 0; tops = null; }, 650);
  };

  const onListKey = (event: KeyboardEvent): void => {
    const item = (event.target as Element | null)?.closest<HTMLElement>('.preview-word-outline-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      item.click();
    } else if (event.key === 'ArrowRight' && collapsed.has(id)) {
      toggle(id);
    } else if (event.key === 'ArrowLeft' && nodes[id]?.children.length && !collapsed.has(id)) {
      toggle(id);
    }
  };

  list.addEventListener('click', onListClick);
  list.addEventListener('keydown', onListKey);
  list.addEventListener('scroll', scheduleRender, { passive: true });
  const unobserve = source.observe(() => {
    tops = null;
    scheduleRefresh();
  });
  refresh();

  return {
    pane,
    refresh,
    dispose(): void {
      disposed = true;
      unobserve();
      onScroll.cancel();
      if (debounceTimer) win.clearTimeout(debounceTimer);
      if (retryTimer) win.clearTimeout(retryTimer);
      if (renderFrame) win.cancelAnimationFrame(renderFrame);
      scroller?.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      list.removeEventListener('click', onListClick);
      list.removeEventListener('keydown', onListKey);
      list.removeEventListener('scroll', scheduleRender);
      pane.remove();
    },
  };
}
