import { resolveWorkspaceTreeIcon, type WorkspaceEntry, type WorkspaceSearchResult } from '@easyview/contracts';
import { tWorkspaceSearch } from './workspaceSearch.i18n';

export interface WorkspaceSearchPanelOptions {
  /** Resolve `null` when the search failed or was superseded. */
  search(query: string): Promise<WorkspaceSearchResult | null>;
  onOpen(entry: WorkspaceEntry): void;
  onClose(): void;
  /** Called when the query switches between empty and non-empty (hosts swap the tree for results). */
  onQueryActiveChange(): void;
}

const SEARCH_DEBOUNCE_MS = 120;
/** File-watcher bursts coalesce into one re-search. */
const REFRESH_DEBOUNCE_MS = 300;

export const WORKSPACE_SEARCH_ICON_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';

/** Find-by-name panel shared by the Desktop and Extension workspace trees. */
export class WorkspaceSearchPanel {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private query = '';
  private result: WorkspaceSearchResult | null = null;
  private pending = false;
  private failed = false;
  private activeIndex = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: WorkspaceSearchPanelOptions) {
    ensureStyles();
    this.element = document.createElement('div');
    this.element.className = 'workspace-search';
    const bar = document.createElement('div');
    bar.className = 'workspace-search-bar';
    const icon = document.createElement('span');
    icon.className = 'workspace-search-bar-icon';
    icon.innerHTML = WORKSPACE_SEARCH_ICON_SVG;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'workspace-search-input';
    this.input.placeholder = tWorkspaceSearch('placeholder');
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', tWorkspaceSearch('placeholder'));
    // Hosts re-render (and briefly detach this input) when the query turns non-empty, which would
    // force-commit an IME composition; only read the query once composition has ended.
    this.input.addEventListener('input', (event) => {
      if ((event as InputEvent).isComposing) return;
      this.setQuery(this.input.value);
    });
    this.input.addEventListener('compositionend', () => this.setQuery(this.input.value));
    this.input.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'workspace-search-clear';
    this.clearButton.title = tWorkspaceSearch('close');
    this.clearButton.textContent = '×';
    this.clearButton.addEventListener('click', () => this.options.onClose());
    bar.append(icon, this.input, this.clearButton);
    this.status = document.createElement('div');
    this.status.className = 'workspace-search-status';
    this.list = document.createElement('div');
    this.list.className = 'workspace-search-results';
    this.list.setAttribute('role', 'listbox');
    this.element.append(bar, this.status, this.list);
    this.renderResults();
  }

  /** True while a non-blank query is shown; hosts hide the tree then. */
  get hasQuery(): boolean {
    return this.query.trim().length > 0;
  }

  hasFocus(): boolean {
    return this.element.contains(document.activeElement);
  }

  focus(select = false): void {
    this.input.focus({ preventScroll: true });
    if (select) this.input.select();
  }

  /** Re-run the current query, e.g. after the file tree changed. */
  refresh(): void {
    if (this.hasQuery) this.schedule(REFRESH_DEBOUNCE_MS);
  }

  reset(): void {
    clearTimeout(this.timer);
    this.seq += 1;
    const wasActive = this.hasQuery;
    this.query = '';
    this.input.value = '';
    this.result = null;
    this.pending = false;
    this.failed = false;
    this.activeIndex = 0;
    this.renderResults();
    if (wasActive) this.options.onQueryActiveChange();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.seq += 1;
    this.element.remove();
  }

  private setQuery(value: string): void {
    if (value === this.query) return;
    const wasActive = this.hasQuery;
    this.query = value;
    this.activeIndex = 0;
    if (!this.hasQuery) {
      clearTimeout(this.timer);
      this.seq += 1;
      this.result = null;
      this.pending = false;
      this.failed = false;
    } else {
      this.pending = true;
      this.schedule(SEARCH_DEBOUNCE_MS);
    }
    this.renderResults();
    if (wasActive !== this.hasQuery) this.options.onQueryActiveChange();
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    const seq = ++this.seq;
    this.timer = setTimeout(() => {
      const query = this.query.trim();
      void this.options.search(query).then((result) => {
        if (seq !== this.seq) return;
        this.pending = false;
        this.failed = result === null;
        this.result = result;
        this.activeIndex = Math.min(this.activeIndex, Math.max(0, (result?.entries.length ?? 1) - 1));
        this.renderResults();
      });
    }, delay);
  }

  private onKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    // Arrows, Enter and Escape belong to the IME candidate window while composing.
    if (event.isComposing || event.keyCode === 229) return;
    const entries = this.result?.entries ?? [];
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.hasQuery) {
        this.input.value = '';
        this.setQuery('');
      } else {
        this.options.onClose();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (entries.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = (this.activeIndex + step + entries.length) % entries.length;
      this.renderResults();
      this.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[this.activeIndex];
      if (entry) this.options.onOpen(entry);
    }
  }

  private renderResults(): void {
    this.element.classList.toggle('has-query', this.hasQuery);
    this.list.replaceChildren();
    const entries = this.result?.entries ?? [];
    let statusText = '';
    if (this.hasQuery) {
      if (this.failed) statusText = tWorkspaceSearch('failed');
      else if (this.pending && entries.length === 0) statusText = tWorkspaceSearch('searching');
      else if (entries.length === 0) statusText = tWorkspaceSearch('noResults');
      else if (this.result?.truncated) statusText = tWorkspaceSearch('truncated', { count: entries.length });
      else statusText = tWorkspaceSearch('count', { count: entries.length });
    }
    this.status.textContent = statusText;
    this.status.hidden = !statusText;
    if (!this.hasQuery) return;
    const terms = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    entries.forEach((entry, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'workspace-search-result';
      row.classList.toggle('is-active', index === this.activeIndex);
      row.dataset.relativePath = entry.relativePath;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === this.activeIndex));
      row.title = entry.relativePath;
      const icon = document.createElement('span');
      icon.className = 'workspace-search-result-icon';
      const iconDesc = resolveWorkspaceTreeIcon({ kind: entry.kind, name: entry.name, expanded: false });
      icon.dataset.icon = iconDesc.id;
      icon.innerHTML = iconDesc.svg;
      const name = document.createElement('span');
      name.className = 'workspace-search-result-name';
      appendHighlighted(name, entry.name, terms);
      const parent = document.createElement('span');
      parent.className = 'workspace-search-result-path';
      parent.textContent = entry.relativePath.includes('/') ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/')) : '';
      row.append(icon, name, parent);
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', () => {
        this.activeIndex = index;
        this.renderResults();
        this.options.onOpen(entry);
      });
      this.list.appendChild(row);
    });
  }
}

function appendHighlighted(target: HTMLElement, text: string, terms: readonly string[]): void {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let from = lower.indexOf(term); from >= 0; from = lower.indexOf(term, from + 1)) {
      for (let index = from; index < from + term.length; index += 1) marked[index] = true;
    }
  }
  let start = 0;
  while (start < text.length) {
    let end = start;
    while (end < text.length && marked[end] === marked[start]) end += 1;
    const chunk = text.slice(start, end);
    if (marked[start]) {
      const mark = document.createElement('mark');
      mark.textContent = chunk;
      target.appendChild(mark);
    } else {
      target.appendChild(document.createTextNode(chunk));
    }
    start = end;
  }
}

function ensureStyles(): void {
  if (document.getElementById('easyview-workspace-search-styles')) return;
  const style = document.createElement('style');
  style.id = 'easyview-workspace-search-styles';
  style.textContent = `.workspace-search{display:flex;flex-direction:column;flex:0 0 auto;min-height:0}.workspace-search.has-query{flex:1 1 auto}.workspace-search-bar{display:flex;align-items:center;gap:4px;margin:6px 8px;padding:0 4px 0 6px;height:26px;box-sizing:border-box;border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#8884));border-radius:4px;background:var(--vscode-input-background,transparent);color:var(--vscode-input-foreground,inherit)}.workspace-search-bar:focus-within{border-color:color-mix(in srgb,currentColor 40%,transparent)}.workspace-search-bar-icon{display:inline-flex;opacity:.6}.workspace-search-bar-icon svg{width:14px;height:14px}.workspace-search-input{flex:1;min-width:0;border:0;outline:0;padding:0;background:transparent;color:inherit;font:inherit;font-size:12px}.workspace-search-bar .workspace-search-input:focus,.workspace-search-bar .workspace-search-input:focus-visible{outline:none!important;box-shadow:none!important}.workspace-search-clear{width:20px;height:20px;flex:0 0 20px;border:0;border-radius:3px;padding:0;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer;opacity:.65}.workspace-search-clear:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground,#8882)}.workspace-search-status{padding:0 12px 4px;font-size:11px;opacity:.65}.workspace-search-status[hidden]{display:none}.workspace-search-results{flex:1 1 auto;min-height:0;overflow:auto}.workspace-search-result{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 10px 0 12px;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;white-space:nowrap}.workspace-search-result:hover{background:var(--vscode-list-hoverBackground,#8882)}.workspace-search-result.is-active{background:var(--easyview-list-selection-background,var(--vscode-list-activeSelectionBackground,#094771));color:var(--vscode-list-activeSelectionForeground,inherit)}.workspace-search-result-icon{display:inline-flex;flex:0 0 16px;width:16px;height:16px}.workspace-search-result-icon svg{width:16px;height:16px}.workspace-search-result-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.workspace-search-result-name mark{background:transparent;color:var(--mdpre-accent,var(--vscode-textLink-foreground,#3b82f6));font-weight:600}.workspace-search-result-path{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11px;opacity:.6}`;
  document.head.appendChild(style);
}
