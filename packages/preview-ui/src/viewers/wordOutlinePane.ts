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
import {
  readWordOutlinePinned,
  readWordOutlineSide,
  writeWordOutlinePinned,
  writeWordOutlineSide,
  type WordOutlineSide,
} from './wordOutlinePrefs';
import { writePreviewSidebarHidden } from '../previewSidebarToggle';
import { tPreview } from '../preview.i18n';

export interface WordOutlineLabels {
  title: string;
  empty: string;
  inferred: string;
  inferredHint: string;
  expand: string;
  collapse: string;
  pin: string;
  unpin: string;
  miniMapLabel: string;
  dock: string;
}

export function wordOutlineLabels(): WordOutlineLabels {
  return {
    title: tPreview('word.outline'),
    empty: tPreview('word.outlineEmpty'),
    inferred: tPreview('word.outlineInferred'),
    inferredHint: tPreview('word.outlineInferredHint'),
    expand: tPreview('word.outlineExpand'),
    collapse: tPreview('word.outlineCollapse'),
    pin: tPreview('word.outlinePin'),
    unpin: tPreview('word.outlineUnpin'),
    miniMapLabel: tPreview('word.outlineMiniMap'),
    dock: tPreview('word.outlineDock'),
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
  minimap: HTMLElement;
  /** Re-collect headings now (otherwise debounced through `observe`). */
  refresh(): void;
  setPinned(pinned: boolean): void;
  setSide(side: WordOutlineSide): void;
  dispose(): void;
}

export const WORD_OUTLINE_ROW_HEIGHT = 26;
const OVERSCAN = 8;
const FALLBACK_VIEWPORT_ROWS = 60;
const REFRESH_DEBOUNCE_MS = 300;
/** Give a slow document about 30 s to lay out before showing the empty state. */
const MAX_RETRIES = 120;
const SCROLL_THROTTLE_MS = 80;
const MINI_MAP_MAX_DASHES = 28;
const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z"/><path d="M12 14v6"/></svg>';
const UNPIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M15 4.5v15"/><path d="m9 9 3 3-3 3"/></svg>';
const DOCK_GRIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';

function layoutHosts(container: HTMLElement): HTMLElement[] {
  const hosts = new Set<HTMLElement>([container]);
  const shell = container.closest<HTMLElement>('.file-viewer-web-shell');
  const viewer = container.closest<HTMLElement>('.preview-universal-viewer');
  const mount = container.closest<HTMLElement>('.preview-word-mount') ?? (container.classList.contains('preview-word-mount') ? container : null);
  if (shell) hosts.add(shell);
  if (viewer) hosts.add(viewer);
  if (mount) hosts.add(mount);
  return [...hosts];
}

/**
 * Word outline chrome: virtualised sidebar + Markdown-like pulse minimap (popup + pin) with
 * left/right docking inside the preview shell (not Markdown panelDock / TableOfContents).
 */
export function installWordOutline(
  container: HTMLElement,
  source: WordOutlineSource,
  labels: WordOutlineLabels,
  options: { before?: Element | null } = {},
): WordOutlineController {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;

  let pinned = readWordOutlinePinned();
  let side: WordOutlineSide = readWordOutlineSide();

  const pane = doc.createElement('nav');
  pane.className = 'preview-word-outline';
  pane.dataset.state = 'loading';
  pane.setAttribute('aria-label', labels.title);

  const head = doc.createElement('div');
  head.className = 'preview-word-outline-head';
  const grip = doc.createElement('span');
  grip.className = 'preview-word-outline-dock-grip';
  grip.dataset.wordOutlineDock = '1';
  grip.title = labels.dock;
  grip.setAttribute('aria-label', labels.dock);
  grip.innerHTML = DOCK_GRIP_ICON;
  const title = doc.createElement('span');
  title.className = 'preview-word-outline-title';
  title.textContent = labels.title;
  const badge = doc.createElement('span');
  badge.className = 'preview-word-outline-badge';
  badge.textContent = labels.inferred;
  badge.title = labels.inferredHint;
  badge.hidden = true;
  const unpinBtn = doc.createElement('button');
  unpinBtn.type = 'button';
  unpinBtn.className = 'preview-word-outline-unpin';
  unpinBtn.title = labels.unpin;
  unpinBtn.setAttribute('aria-label', labels.unpin);
  unpinBtn.innerHTML = UNPIN_ICON;
  head.append(grip, title, badge, unpinBtn);

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

  const minimap = doc.createElement('div');
  minimap.className = 'preview-word-minimap';
  minimap.hidden = true;
  const rail = doc.createElement('div');
  rail.className = 'preview-word-minimap-rail';
  rail.setAttribute('aria-hidden', 'true');
  rail.tabIndex = 0;
  const panel = doc.createElement('nav');
  panel.className = 'preview-word-minimap-panel';
  panel.setAttribute('aria-label', labels.miniMapLabel);
  const miniHead = doc.createElement('div');
  miniHead.className = 'preview-word-minimap-header';
  const miniTitle = doc.createElement('span');
  miniTitle.textContent = labels.title;
  const pinBtn = doc.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'preview-word-minimap-pin';
  pinBtn.title = labels.pin;
  pinBtn.setAttribute('aria-label', labels.pin);
  pinBtn.innerHTML = PIN_ICON;
  miniHead.append(miniTitle, pinBtn);
  const miniList = doc.createElement('ul');
  miniList.className = 'preview-word-minimap-list';
  panel.append(miniHead, miniList);
  minimap.append(rail, panel);

  container.insertBefore(pane, options.before ?? null);
  container.insertBefore(minimap, pane.nextSibling);

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
  let miniMapActiveId = -1;
  const rendered = new Map<number, HTMLElement>();

  const rowIndexOf = (id: number): number => rows.findIndex(row => row.node.id === id);

  const applyChrome = (): void => {
    const mode = pinned ? 'sidebar' : 'minimap';
    const sidebarState = pinned ? 'visible' : 'hidden';
    for (const host of layoutHosts(container)) {
      host.dataset.wordOutlineMode = mode;
      host.dataset.wordOutlineSide = side;
      host.dataset.previewSidebar = sidebarState;
    }
    pane.classList.toggle('preview-word-outline-right', side === 'right');
    pane.classList.toggle('preview-word-outline-left', side === 'left');
    pane.hidden = !pinned;
    minimap.classList.toggle('preview-word-minimap-left', side === 'left');
    minimap.classList.toggle('preview-word-minimap-right', side === 'right');
    const showMini = !pinned && headings.length > 0;
    minimap.hidden = !showMini;
    if (!showMini) minimap.classList.remove('is-open');
    writePreviewSidebarHidden(!pinned);
  };

  const setPinned = (next: boolean): void => {
    if (pinned === next) {
      applyChrome();
      return;
    }
    pinned = next;
    writeWordOutlinePinned(pinned);
    applyChrome();
    container.dispatchEvent(new CustomEvent('easyview-word-outline-pinned', {
      bubbles: true,
      detail: { pinned },
    }));
    if (pinned) {
      // Render immediately so pin works under tests without waiting for rAF.
      rebuildRows();
    } else {
      renderMiniMap();
    }
  };

  const setSide = (next: WordOutlineSide): void => {
    if (side === next) return;
    side = next;
    writeWordOutlineSide(side);
    applyChrome();
  };

  const renderRows = (): void => {
    renderFrame = 0;
    if (disposed || !pinned) return;
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
    if (activeId < 0 || !nodes[activeId] || !pinned) return;
    const index = rowIndexOf(visibleAncestor(nodes, collapsed, activeId));
    if (index < 0 || !list.clientHeight) return;
    const top = index * WORD_OUTLINE_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - WORD_OUTLINE_ROW_HEIGHT);
    else if (top + WORD_OUTLINE_ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight + WORD_OUTLINE_ROW_HEIGHT * 2;
    }
  };

  const pickMiniMapRailHeadings = (minLevel: number): WordOutlineHeading[] => {
    for (let depth = 3; depth >= 0; depth -= 1) {
      const candidates = headings.filter((heading) => heading.level - minLevel <= depth);
      if (candidates.length <= MINI_MAP_MAX_DASHES) return candidates;
      if (depth === 0) {
        return Array.from({ length: MINI_MAP_MAX_DASHES }, (_, index) =>
          candidates[Math.floor((index * candidates.length) / MINI_MAP_MAX_DASHES)]!);
      }
    }
    return [];
  };

  const highlightMiniMap = (): void => {
    if (minimap.hidden || pinned) return;
    const id = activeId >= 0 ? activeId : (headings.length ? 0 : -1);
    if (id === miniMapActiveId) return;
    miniMapActiveId = id;
    miniList.querySelectorAll<HTMLElement>('.preview-word-minimap-item').forEach((item) => {
      item.classList.toggle('active', Number(item.dataset.id) === id);
    });
    let activeDash: HTMLElement | null = null;
    rail.querySelectorAll<HTMLElement>('.preview-word-minimap-dash').forEach((dash) => {
      dash.classList.remove('active');
      if (id >= 0 && Number(dash.dataset.id) <= id) activeDash = dash;
    });
    (activeDash as HTMLElement | null)?.classList.add('active');
  };

  const renderMiniMap = (): void => {
    miniMapActiveId = -1;
    rail.replaceChildren();
    miniList.replaceChildren();
    applyChrome();
    if (pinned || !headings.length) return;

    const minLevel = headings.reduce((min, heading) => Math.min(min, heading.level), Infinity);
    for (const heading of pickMiniMapRailHeadings(minLevel)) {
      const index = headings.indexOf(heading);
      const dash = doc.createElement('span');
      dash.className = 'preview-word-minimap-dash';
      dash.dataset.id = String(index);
      dash.dataset.depth = String(Math.min(3, heading.level - minLevel));
      rail.appendChild(dash);
    }
    headings.forEach((heading, index) => {
      const item = doc.createElement('li');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'preview-word-minimap-item';
      button.dataset.id = String(index);
      button.dataset.depth = String(Math.min(4, heading.level - minLevel));
      button.textContent = heading.text || labels.empty;
      button.title = heading.text;
      button.addEventListener('click', () => {
        bindScroller();
        source.reveal(heading, scroller);
        pinnedUntil = Date.now() + 600;
        activeId = index;
        highlightMiniMap();
        win.setTimeout(() => { pinnedUntil = 0; tops = null; }, 650);
      });
      item.appendChild(button);
      miniList.appendChild(item);
    });
    highlightMiniMap();
  };

  const setActive = (id: number): void => {
    if (id === activeId) return;
    activeId = id;
    scrollActiveIntoView();
    if (pinned) renderRows();
    else highlightMiniMap();
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
      const sameShape = previous.length === nodes.length && previous.every((node, i) => node.heading.level === nodes[i]!.heading.level);
      collapsed = sameShape ? new Set([...previousCollapsed].filter(id => nodes[id]?.children.length)) : defaultCollapsed(nodes);
      if (!sameShape) activeId = -1;
      pane.dataset.state = headings.length ? 'ready' : 'empty';
      badge.hidden = !headings.some(h => h.inferred);
      rebuildRows();
      renderMiniMap();
    } else {
      headings = next;
      pane.dataset.state = headings.length ? 'ready' : 'empty';
      applyChrome();
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

  const openMiniPopup = (): void => {
    if (pinned || minimap.hidden) return;
    minimap.classList.add('is-open');
    const active = miniList.querySelector<HTMLElement>('.preview-word-minimap-item.active');
    if (active) miniList.scrollTop = active.offsetTop - (miniList.clientHeight - active.offsetHeight) / 2;
  };

  const onRailActivate = (event: Event): void => {
    event.preventDefault();
    if (minimap.classList.contains('is-open')) minimap.classList.remove('is-open');
    else openMiniPopup();
  };

  const onMiniEnter = (): void => {
    const active = miniList.querySelector<HTMLElement>('.preview-word-minimap-item.active');
    if (active) miniList.scrollTop = active.offsetTop - (miniList.clientHeight - active.offsetHeight) / 2;
  };

  const onDocPointerDown = (event: PointerEvent): void => {
    if (!minimap.classList.contains('is-open')) return;
    const target = event.target as Node | null;
    if (target && minimap.contains(target)) return;
    minimap.classList.remove('is-open');
  };

  // Self-contained left/right dock (preview shell only; does not use desktop panelDock).
  let dockCleanup: (() => void) | null = null;
  const beginDockDrag = (startX: number, startY: number): void => {
    dockCleanup?.();
    const overlay = doc.createElement('div');
    overlay.className = 'preview-word-outline-dock-overlay';
    const host = container.closest<HTMLElement>('.preview-word-mount, .file-viewer-web-shell, .preview-universal-viewer') ?? container;
    const area = host.getBoundingClientRect();
    const zoneW = Math.min(220, area.width / 3);
    const zones: Array<{ side: WordOutlineSide; el: HTMLElement; rect: DOMRect }> = [];
    for (const dockSide of ['left', 'right'] as const) {
      if (dockSide === side) continue;
      const rect = new DOMRect(
        dockSide === 'left' ? area.left : area.right - zoneW,
        area.top,
        zoneW,
        area.height,
      );
      const el = doc.createElement('div');
      el.className = 'preview-word-outline-dock-zone';
      el.dataset.side = dockSide;
      Object.assign(el.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const label = doc.createElement('span');
      label.className = 'preview-word-outline-dock-zone-label';
      label.textContent = dockSide === 'left' ? '←' : '→';
      el.append(label);
      overlay.append(el);
      zones.push({ side: dockSide, el, rect });
    }
    const ghost = doc.createElement('div');
    ghost.className = 'preview-word-outline-dock-ghost';
    ghost.textContent = labels.title;
    overlay.append(ghost);
    doc.body.append(overlay);
    doc.body.classList.add('preview-word-outline-docking');

    let hovered: typeof zones[number] | null = null;
    const move = (x: number, y: number): void => {
      ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
      const next = zones.find(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) ?? null;
      if (next === hovered) return;
      hovered?.el.classList.remove('is-active');
      next?.el.classList.add('is-active');
      hovered = next;
    };
    move(startX, startY);

    const onMove = (event: PointerEvent): void => move(event.clientX, event.clientY);
    const onUp = (event: PointerEvent): void => {
      const target = hovered?.side ?? null;
      cleanup();
      if (target) setSide(target);
      event.preventDefault();
    };
    const cleanup = (): void => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', onUp);
      win.removeEventListener('pointercancel', onUp);
      overlay.remove();
      doc.body.classList.remove('preview-word-outline-docking');
      dockCleanup = null;
    };
    dockCleanup = cleanup;
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
  };

  const onGripPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    const onMove = (moveEvent: PointerEvent): void => {
      if (!started && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
      if (!started) {
        started = true;
        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onCancel);
        win.removeEventListener('pointercancel', onCancel);
        beginDockDrag(moveEvent.clientX, moveEvent.clientY);
      }
    };
    const onCancel = (): void => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', onCancel);
      win.removeEventListener('pointercancel', onCancel);
    };
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onCancel);
    win.addEventListener('pointercancel', onCancel);
  };

  const onHostAttr = (mutations: MutationRecord[]): void => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'data-preview-sidebar') continue;
      const host = mutation.target as HTMLElement;
      const nextPinned = host.dataset.previewSidebar !== 'hidden';
      if (nextPinned !== pinned) {
        pinned = nextPinned;
        writeWordOutlinePinned(pinned);
        applyChrome();
        if (pinned) scheduleRender();
        else renderMiniMap();
      }
    }
  };
  const hostObserver = typeof MutationObserver === 'function' ? new MutationObserver(onHostAttr) : null;
  for (const host of layoutHosts(container)) {
    hostObserver?.observe(host, { attributes: true, attributeFilter: ['data-preview-sidebar'] });
  }

  const onUnpinClick = (): void => setPinned(false);
  const onPinClick = (): void => setPinned(true);
  const onRailKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') onRailActivate(event);
  };
  unpinBtn.addEventListener('click', onUnpinClick);
  pinBtn.addEventListener('click', onPinClick);
  grip.addEventListener('pointerdown', onGripPointerDown);
  rail.addEventListener('click', onRailActivate);
  rail.addEventListener('keydown', onRailKey);
  minimap.addEventListener('mouseenter', onMiniEnter);
  doc.addEventListener('pointerdown', onDocPointerDown, true);

  list.addEventListener('click', onListClick);
  list.addEventListener('keydown', onListKey);
  list.addEventListener('scroll', scheduleRender, { passive: true });
  const unobserve = source.observe(() => {
    tops = null;
    scheduleRefresh();
  });
  applyChrome();
  refresh();

  return {
    pane,
    minimap,
    refresh,
    setPinned,
    setSide,
    dispose(): void {
      disposed = true;
      unobserve();
      onScroll.cancel();
      dockCleanup?.();
      hostObserver?.disconnect();
      if (debounceTimer) win.clearTimeout(debounceTimer);
      if (retryTimer) win.clearTimeout(retryTimer);
      if (renderFrame) win.cancelAnimationFrame(renderFrame);
      scroller?.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      list.removeEventListener('click', onListClick);
      list.removeEventListener('keydown', onListKey);
      list.removeEventListener('scroll', scheduleRender);
      unpinBtn.removeEventListener('click', onUnpinClick);
      pinBtn.removeEventListener('click', onPinClick);
      grip.removeEventListener('pointerdown', onGripPointerDown);
      rail.removeEventListener('click', onRailActivate);
      rail.removeEventListener('keydown', onRailKey);
      minimap.removeEventListener('mouseenter', onMiniEnter);
      doc.removeEventListener('pointerdown', onDocPointerDown, true);
      for (const host of layoutHosts(container)) {
        delete host.dataset.wordOutlineMode;
        delete host.dataset.wordOutlineSide;
      }
      pane.remove();
      minimap.remove();
    },
  };
}
