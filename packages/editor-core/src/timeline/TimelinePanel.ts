import { isTimelineMarkdown, type TimelineClient, type TimelineEntry, type TimelineSource, type TimelineUiState } from '@easyview/contracts';
import { getLocale } from '@easyview/contracts/i18n';
import { tTimeline } from './timeline.i18n';
const SOURCES: TimelineSource[] = ['local', 'vscode', 'cursor', 'git'];
const sourceLabel = (source: TimelineSource): string => tTimeline(`source.${source}`);
const filterLabel = (source: TimelineSource): string => tTimeline(`filter.${source}`);
const HEADER_HEIGHT = 24;
/** Header plus the 1px top divider; the panel is border-box. */
const COLLAPSED_HEIGHT = HEADER_HEIGHT + 1;
const ROW_HEIGHT = 26;
/** Owned DOM listeners, one active query and one selected-file subscription; no timers. */
export class TimelinePanel {
  readonly element = document.createElement('section');
  private header = document.createElement('button');
  private body = document.createElement('div');
  private tools = document.createElement('div');
  private filterButton?: HTMLButtonElement;
  private state: TimelineUiState;
  private filePath: string | null = null;
  private sources = [...SOURCES];
  private entries: TimelineEntry[] = [];
  private selectedEntryKey: string | null = null;
  private cursor?: string;
  private abort?: AbortController;
  private action?: AbortController;
  private subscription?: { dispose(): void };
  private visible = true;
  private destroyed = false;
  private revision = 0;
  private resizeObserver: ResizeObserver;
  private menu?: HTMLElement;
  constructor(private readonly client: TimelineClient) {
    this.state = client.loadState() ?? { expanded: true, height: 220 };
    this.state.height = Math.max(100, Math.min(1000, this.state.height));
    this.ensureStyles();
    this.element.className = 'easyview-timeline';
    const sash = document.createElement('div'); sash.className = 'easyview-timeline-sash';
    sash.setAttribute('role', 'separator'); sash.setAttribute('aria-orientation', 'horizontal');
    sash.addEventListener('pointerdown', this.startResize);
    this.header.className = 'easyview-timeline-header'; this.header.type = 'button';
    this.header.addEventListener('click', this.toggle);
    this.body.className = 'easyview-timeline-body';
    const heading = document.createElement('div'); heading.className = 'easyview-timeline-heading';
    this.tools.className = 'easyview-timeline-tools';
    heading.append(this.header, this.tools);
    this.element.append(sash, heading, this.body);
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.element);
    this.render();
  }
  setFile(filePath: string | null): void {
    if (filePath === this.filePath) return;
    this.filePath = filePath; this.selectedEntryKey = null; this.stop(); this.entries = []; this.cursor = undefined; this.render();
    this.connect();
  }
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) this.stop(); else this.connect();
  }
  refresh = (): void => { if (this.canLoad()) void this.load(false); };
  dispose(): void {
    this.destroyed = true; this.stop(); this.action?.abort(); this.removeMenu();
    this.resizeObserver.disconnect(); this.endResize(); this.element.remove();
  }
  private canLoad(): boolean { return !this.destroyed && this.visible && this.state.expanded && !!this.filePath && isTimelineMarkdown(this.filePath); }
  private connect(): void {
    if (!this.canLoad()) return;
    this.subscription = this.client.watch(this.filePath!, this.refresh);
    this.refresh();
  }
  private stop(): void { this.action?.abort(); this.action = undefined; this.revision++; this.abort?.abort(); this.abort = undefined; this.subscription?.dispose(); this.subscription = undefined; this.removeMenu(); }
  private toggle = (): void => {
    this.state.expanded = !this.state.expanded; this.client.saveState(this.state); this.stop(); this.render(); this.connect();
  };
  private async load(more: boolean): Promise<void> {
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const revision = ++this.revision;
    try {
      const page = await this.client.list(this.filePath!, this.sources, more ? this.cursor : undefined, abort.signal);
      if (abort.signal.aborted || revision !== this.revision || this.destroyed) return;
      this.entries = more ? [...this.entries, ...page.entries] : page.entries;
      this.cursor = page.cursor; this.render(page.errors.map((e) => tTimeline('sourceError', { source: sourceLabel(e.source), message: e.message })).join('\n'));
    } catch (error) {
      if (!abort.signal.aborted && revision === this.revision) this.render(error instanceof Error ? error.message : String(error));
    } finally { if (this.abort === abort) this.abort = undefined; }
  }
  private render(error?: string): void {
    const chevron = document.createElement('span');
    chevron.className = 'easyview-timeline-chevron';
    chevron.classList.toggle('is-expanded', this.state.expanded);
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
    const title = document.createElement('span');
    title.className = 'easyview-timeline-title';
    title.textContent = tTimeline('title');
    this.header.replaceChildren(chevron, title);
    this.header.setAttribute('aria-expanded', String(this.state.expanded));
    this.header.title = this.filePath ?? tTimeline('selectMarkdown');
    this.body.hidden = !this.state.expanded;
    const previousScroll = this.body.querySelector<HTMLElement>('.easyview-timeline-list')?.scrollTop ?? 0;
    this.body.replaceChildren(); this.layout();
    this.tools.replaceChildren();
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = '↻'; refresh.title = tTimeline('refresh'); refresh.setAttribute('aria-label', tTimeline('refreshTimeline')); refresh.onclick = this.refresh;
    this.tools.append(refresh);
    if (this.client.configureSettings) { const settings = document.createElement('button'); settings.type = 'button'; settings.textContent = '⚙'; settings.title = tTimeline('settings'); settings.onclick = () => { void this.client.configureSettings!().catch((error) => this.render(String(error))); }; this.tools.append(settings); }
    const filter = document.createElement('button'); filter.type = 'button'; filter.className = 'easyview-timeline-filter'; filter.title = tTimeline('filterSources'); filter.setAttribute('aria-label', tTimeline('filterSources')); filter.setAttribute('aria-haspopup', 'menu');
    filter.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v7l-4 2v-9Z"/></svg>';
    filter.classList.toggle('active', this.sources.length !== SOURCES.length);
    filter.setAttribute('aria-expanded', String(this.menu?.classList.contains('easyview-timeline-filter-menu') ?? false));
    filter.onclick = () => { if (this.menu?.classList.contains('easyview-timeline-filter-menu')) this.removeMenu(); else this.showFilterMenu(filter); };
    this.filterButton = filter; this.tools.append(filter);
    if (!this.state.expanded) return;
    const list = document.createElement('div'); list.className = 'easyview-timeline-list'; list.setAttribute('role', 'list');
    if (error) { const notice = document.createElement('div'); notice.className = 'easyview-timeline-notice'; notice.textContent = error; list.append(notice); }
    if (!this.entries.length) {
      const empty = document.createElement('div'); empty.className = 'easyview-timeline-notice';
      empty.textContent = !this.filePath || !isTimelineMarkdown(this.filePath) ? tTimeline('selectSavedMarkdown') : tTimeline('empty'); list.append(empty);
    }
    const canvas = document.createElement('div'); canvas.style.position = 'relative'; canvas.style.height = `${this.entries.length * ROW_HEIGHT}px`;
    list.append(canvas);
    const renderRows = () => {
      canvas.replaceChildren();
      const start = Math.max(0, Math.floor(list.scrollTop / ROW_HEIGHT) - 5);
      const end = Math.min(this.entries.length, start + Math.max(20, Math.ceil((list.clientHeight || 220) / ROW_HEIGHT) + 10));
      for (let index = start; index < end; index++) {
      const entry = this.entries[index];
      const row = document.createElement('button'); row.className = 'easyview-timeline-entry'; row.type = 'button';
      row.dataset.timelineEntryKey = this.entryKey(entry);
      row.classList.toggle('selected', row.dataset.timelineEntryKey === this.selectedEntryKey);
      row.setAttribute('aria-pressed', String(row.dataset.timelineEntryKey === this.selectedEntryKey));
      row.title = `${entry.label}\n${sourceLabel(entry.source)} · ${entry.author ?? ''} · ${new Date(entry.timestamp).toLocaleString(getLocale())}${entry.revision ? '\n'+entry.revision : ''}`;
      const marker = document.createElement('span'); marker.textContent = entry.source === 'git' ? '⑂' : '○';
      const label = document.createElement('span'); label.className = 'easyview-timeline-label'; label.textContent = entry.label;
      const meta = document.createElement('span'); meta.className = 'easyview-timeline-meta'; meta.textContent = `${sourceLabel(entry.source)} ${entry.author ?? ''} ${(new Date(entry.timestamp).toDateString() === new Date().toDateString() ? new Date(entry.timestamp).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : new Date(entry.timestamp).toLocaleDateString(getLocale()))}`;
      row.append(marker, label, meta);
      row.onclick = () => { this.selectEntry(entry); void this.runAction(entry, false); };
      row.oncontextmenu = (event) => { event.preventDefault(); this.selectEntry(entry); this.showMenu(entry, event); };
      row.style.position = 'absolute'; row.style.top = `${index * ROW_HEIGHT}px`; row.style.height = `${ROW_HEIGHT}px`; row.style.boxSizing = 'border-box'; canvas.append(row);
      }
    };
    list.addEventListener('scroll', renderRows, { passive: true });
    renderRows();
    if (this.cursor) { const more = document.createElement('button'); more.textContent = tTimeline('loadMore'); more.onclick = () => { void this.load(true); }; list.append(more); }
    this.body.append(list);
    list.scrollTop = previousScroll;
    renderRows();
  }
  private entryKey(entry: TimelineEntry): string { return JSON.stringify([entry.source, entry.id, entry.timestamp]); }
  private selectEntry(entry: TimelineEntry): void {
    this.selectedEntryKey = this.entryKey(entry);
    for (const row of this.body.querySelectorAll<HTMLButtonElement>('.easyview-timeline-entry')) {
      const selected = row.dataset.timelineEntryKey === this.selectedEntryKey;
      row.classList.toggle('selected', selected); row.setAttribute('aria-pressed', String(selected));
    }
  }
  private async runAction(entry: TimelineEntry, restore: boolean): Promise<void> {
    this.action?.abort(); const action = new AbortController(); this.action = action;
    try { await (restore ? this.client.restore(entry, action.signal) : this.client.open(entry, action.signal)); if (restore) this.refresh(); }
    catch (error) { if (!action.signal.aborted && !this.destroyed) this.render(error instanceof Error ? error.message : String(error)); }
    finally { if (this.action === action) this.action = undefined; }
  }
  private showMenu(entry: TimelineEntry, event: MouseEvent): void {
    this.removeMenu(); const menu = document.createElement('div'); menu.className = 'easyview-timeline-menu workspace-file-context-menu'; menu.setAttribute('role', 'menu');
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    const label = document.createElement('span'); label.className = 'workspace-menu-item-label'; label.textContent = tTimeline('restoreVersion'); button.append(label);
    button.onclick = () => { this.removeMenu(); void this.runAction(entry, true); };
    menu.append(button); this.mountMenu(menu, event.clientX, event.clientY);
  }
  private showFilterMenu(anchor: HTMLElement): void {
    this.removeMenu();
    const menu = document.createElement('div'); menu.className = 'easyview-timeline-filter-menu workspace-file-context-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', tTimeline('sources'));
    for (const source of SOURCES) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitemcheckbox'); button.style.gap = '8px';
      const check = document.createElement('span'); check.className = 'workspace-menu-item-icon'; check.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'workspace-menu-item-label'; label.style.flex = '1'; label.textContent = filterLabel(source);
      const update = () => { const selected = this.sources.includes(source); check.textContent = selected ? '✓' : ''; button.setAttribute('aria-checked', String(selected)); };
      button.onclick = () => {
        this.sources = SOURCES.filter((item) => item === source ? !this.sources.includes(item) : this.sources.includes(item));
        update(); this.filterButton?.classList.toggle('active', this.sources.length !== SOURCES.length); this.refresh();
      };
      update(); button.append(check, label); menu.append(button);
    }
    const rect = anchor.getBoundingClientRect(); this.mountMenu(menu, rect.right, rect.bottom, true);
    this.filterButton?.setAttribute('aria-expanded', 'true');
  }
  private mountMenu(menu: HTMLElement, x: number, y: number, alignRight = false): void {
    document.body.append(menu); this.menu = menu;
    menu.style.left = `${Math.max(0, Math.min(alignRight ? x - menu.offsetWidth : x, window.innerWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`;
    document.addEventListener('pointerdown', this.dismissMenu, true); document.addEventListener('keydown', this.dismissMenu, true);
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  private dismissMenu = (event: Event): void => {
    if (event instanceof KeyboardEvent) { if (event.key === 'Escape') this.removeMenu(); return; }
    if (event.target instanceof Element && event.target.closest('.easyview-timeline-filter')) return;
    if (!this.menu?.contains(event.target as Node)) this.removeMenu();
  };
  private removeMenu(): void { this.menu?.remove(); this.menu = undefined; this.filterButton?.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', this.dismissMenu, true); document.removeEventListener('keydown', this.dismissMenu, true); }
  private layout(): void {
    const parent = this.element.parentElement;
    const available = parent?.clientHeight ?? 440;
    const headerHeight = parent?.querySelector<HTMLElement>('.workspace-header')?.offsetHeight ?? 0;
    this.element.style.height = `${this.state.expanded ? Math.max(COLLAPSED_HEIGHT, Math.min(this.state.height, available - headerHeight - Math.min(100, available / 2))) : COLLAPSED_HEIGHT}px`;
  }
  private startY = 0;
  private startHeight = 0;
  private startResize = (event: PointerEvent): void => {
    if (!this.state.expanded) return; event.preventDefault(); this.startY = event.clientY; this.startHeight = this.element.offsetHeight;
    document.addEventListener('pointermove', this.resize); document.addEventListener('pointerup', this.endResize); document.addEventListener('pointercancel', this.endResize);
  };
  private resize = (event: PointerEvent): void => { this.state.height = Math.max(100, Math.min(1000, this.startHeight + this.startY - event.clientY)); this.layout(); };
  private endResize = (): void => { document.removeEventListener('pointermove', this.resize); document.removeEventListener('pointerup', this.endResize); document.removeEventListener('pointercancel', this.endResize); if (!this.destroyed) this.client.saveState(this.state); };
  private ensureStyles(): void {
    if (document.getElementById('easyview-timeline-styles')) return;
    const style = document.createElement('style'); style.id = 'easyview-timeline-styles';
    style.textContent = `.easyview-timeline{position:relative;box-sizing:border-box;flex:0 0 auto;display:flex;flex-direction:column;min-height:25px;overflow:hidden;border-top:1px solid var(--vscode-panel-border,#444);color:inherit;font:inherit}.easyview-timeline-sash{position:absolute;top:0;left:0;right:0;height:5px;cursor:ns-resize;z-index:2}.easyview-timeline-heading{height:24px;flex-shrink:0;display:flex;align-items:center;padding:0 4px 0 0;background:color-mix(in srgb,currentColor 5%,transparent)}.easyview-timeline .easyview-timeline-header{height:24px;flex:1;min-width:0;display:flex;align-items:center;gap:4px;padding:0 0 0 4px;text-align:left;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.02em;white-space:nowrap;overflow:hidden}.easyview-timeline-chevron{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;opacity:.7;transition:transform .12s}.easyview-timeline-chevron.is-expanded{transform:rotate(90deg)}.easyview-timeline-chevron svg{display:block}.easyview-timeline-title{min-width:0;overflow:hidden;text-overflow:ellipsis}.easyview-timeline button{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit}.easyview-timeline-body{min-height:0;flex:1;display:flex;flex-direction:column}.easyview-timeline-body[hidden]{display:none}.easyview-timeline-tools{display:flex;align-items:center;gap:3px;flex-shrink:0}.easyview-timeline-heading:not(:hover):not(:focus-within) .easyview-timeline-tools button:not(.active){opacity:0}.easyview-timeline-tools button{display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border-radius:4px;font-size:13px;opacity:.75}.easyview-timeline-tools button:hover{opacity:1;background:var(--vscode-list-hoverBackground,#ffffff16)}.easyview-timeline-tools button.active{opacity:1;background:var(--vscode-list-hoverBackground,#ffffff16)}.easyview-timeline-list{overflow:auto;min-height:0;flex:1}.easyview-timeline .easyview-timeline-entry{display:flex;align-items:center;gap:8px;width:100%;min-height:24px;box-sizing:border-box;padding:3px 10px;font-size:13px;text-align:left}.easyview-timeline-entry:hover{background:var(--vscode-list-hoverBackground,#ffffff16)}.easyview-timeline-entry.selected,.easyview-timeline-entry.selected:hover{background:var(--easyview-list-selection-background,var(--vscode-list-activeSelectionBackground,#094771));color:var(--vscode-list-activeSelectionForeground,#fff)}.easyview-timeline-label{min-width:0;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.easyview-timeline-meta{font-size:11px;opacity:.6;white-space:nowrap}.easyview-timeline-notice{padding:10px;font-size:12px;white-space:pre-wrap;opacity:.7}`;
    document.head.append(style);
  }
}
