import { WorkspaceSearchPanel, WORKSPACE_SEARCH_ICON_SVG } from '@easyview/editor-core/workspace';
import type { DesktopWorkspaceState, WorkspaceEntry, WorkspaceTreeSortMode } from '../../contracts';
import type { EasyViewDesktopApi } from '../../preload/desktopApi';
import {
  describeWorkspaceEntryTimestamps,
  filterWorkspaceEntriesByDotVisibility,
  normalizeWorkspaceViewRelativePath as normalizeRelativePath,
  parentOfWorkspaceViewRelativePath as parentRelativePath,
  collectVisibleWorkspaceTreeRelativePaths,
  computeNextWorkspaceTreeSelection,
  resolveWorkspaceTreeKeyAction,
  resolveWorkspaceTreeDropTarget,
  resolveWorkspaceTreeRowDropZone,
  workspaceTreeDepthFromPointer,
  workspaceTreeDropLineOffset,
  workspaceTreeGapBeforeName,
  isExternalWorkspaceFileDrag,
  collectWorkspaceExternalDropSources,
  resolveWorkspaceTreeIcon,
  type WorkspaceTreeDropTarget,
  workspaceEntryNameSelectionRange,
  workspaceTreeSortModeLabel,
  WORKSPACE_TREE_SORT_MODE_ICONS as SORT_MODE_ICONS,
  workspaceTreeMenuIconSvg,
  type WorkspaceTreeMenuIconId,
} from '@easyview/contracts';
import { tExplorer } from './workspaceExplorer.i18n';

interface WorkspaceExplorerOptions {
  footer?: HTMLElement;
  onSelectionChanged?(filePath: string | null, visible: boolean): void;
  api: EasyViewDesktopApi;
  container: HTMLElement;
  onStateChange(state: DesktopWorkspaceState): void;
  onOpenFile(relativePath: string): Promise<boolean>;
  onOpenWithDefaultApp(relativePath: string): void;
  onRevealInFolder(relativePath: string): void;
}

export class WorkspaceExplorer {
  private state: DesktopWorkspaceState | null = null;
  private readonly entriesByDirectory = new Map<string, WorkspaceEntry[]>();
  private pendingCreate: { parentRelativePath: string; kind: 'file' | 'directory' } | null = null;
  private renameRelativePath: string | null = null;
  private selectedRelativePath: string | null = null;
  private selectedRelativePaths = new Set<string>();
  private selectionAnchorRelativePath: string | null = null;
  private resizing = false;
  private readonly subscriptions: Array<{ unsubscribe(): void }> = [];
  private activeRelativePath: string | null = null;
  /** When true, selection tracks the active tab. User tree clicks turn this off until the tab changes. */
  private selectionFollowsActive = true;
  private sortMode: WorkspaceTreeSortMode = 'name';
  private showCreatedAt = false;
  private showUpdatedAt = false;
  private showDotEntries = true;
  private showTimestampHover = true;
  private sortMenuOpen = false;
  private searchOpen = false;
  private searchPanel: WorkspaceSearchPanel | null = null;
  private timestampTooltipEl: HTMLElement | null = null;
  private dragRelativePath: string | null = null;
  private dropIndicator: HTMLElement | null = null;
  private dropHoverExpandTimer: number | undefined;
  private dropIntent: { targetRelativePath: string; target: WorkspaceTreeDropTarget } | null = null;

  constructor(private readonly options: WorkspaceExplorerOptions) {}

  async initialize(): Promise<DesktopWorkspaceState> {
    const result = await this.options.api.workspace.getState();
    if (!result.ok) throw new Error(result.message);
    this.state = result.value;
    this.activeRelativePath = null;
    this.selectionFollowsActive = true;
    this.subscriptions.push(this.options.api.workspace.onChanged((paths) => { void this.refreshChanged(paths); }));
    this.subscriptions.push(this.options.api.workspace.onRootChanged((next) => { void this.applyOpenedRoot(next); }));
    this.subscriptions.push(this.options.api.workspace.onContextCommand((command, relativePath) => {
      this.selectionFollowsActive = false;
      this.select(relativePath);
      if (command === 'rename') this.beginRename(relativePath);
      if (command === 'paste') void this.refreshChanged([parentRelativePath(relativePath)]);
    }));
    this.options.container.tabIndex = 0;
    this.options.container.addEventListener('keydown', this.handleKeyDown);
    this.options.container.addEventListener('dragover', this.handleContainerDragOver);
    this.options.container.addEventListener('drop', this.handleContainerDrop);
    this.render();
    if (this.state.rootPath) {
      await this.loadSortMode();
      await this.loadDirectory('');
    }
    return this.state;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.options.container.removeEventListener('keydown', this.handleKeyDown);
    this.options.container.removeEventListener('dragover', this.handleContainerDragOver);
    this.options.container.removeEventListener('drop', this.handleContainerDrop);
    this.hideTimestampTooltip();
    this.timestampTooltipEl?.remove();
    this.timestampTooltipEl = null;
    this.searchPanel?.dispose();
    this.searchPanel = null;
  }

  toggle(): void {
    if (!this.state) return;
    if (!this.state.rootPath) { void this.openFolder(); return; }
    this.updateState({ explorerVisible: !this.state.explorerVisible });
  }

  async openFolder(): Promise<boolean> {
    const result = await this.options.api.workspace.openFolder();
    if (!result.ok || !result.value) return false;
    await this.applyOpenedRoot(result.value);
    return true;
  }

  async openRecentFolder(folderPath: string): Promise<boolean> {
    const result = await this.options.api.workspace.openRecentFolder(folderPath);
    if (!result.ok) { window.alert(result.message); return false; }
    if (!result.value) return false;
    await this.applyOpenedRoot(result.value);
    return true;
  }

  /** Both the IPC reply and the `rootChanged` broadcast land here; only the first one reloads. */
  private async applyOpenedRoot(next: DesktopWorkspaceState): Promise<void> {
    if (this.state?.rootPath === next.rootPath) {
      if (this.state.explorerVisible !== next.explorerVisible) this.updateState({ explorerVisible: next.explorerVisible });
      return;
    }
    this.state = next;
    this.activeRelativePath = null;
    this.selectionFollowsActive = true;
    this.selectedRelativePath = null;
    this.selectedRelativePaths.clear();
    this.selectionAnchorRelativePath = null;
    this.entriesByDirectory.clear();
    this.pendingCreate = null;
    this.renameRelativePath = null;
    this.searchOpen = false;
    this.searchPanel?.reset();
    this.render();
    this.options.onStateChange(next);
    await this.loadSortMode();
    await this.loadDirectory('');
  }

  setOutlineVisible(visible: boolean): void {
    if (this.state?.outlineVisible !== visible) this.updateState({ outlineVisible: visible });
  }

  setActiveDocument(filePath: string | null): void { this.setActiveRelativePath(this.relativePathFor(filePath)); }

  setActiveRelativePath(relativePath: string | null): void {
    if (!this.state) return;
    const changed = this.activeRelativePath !== relativePath;
    if (!changed) {
      // Same open file: never yank selection back while the user is browsing the tree.
      return;
    }

    this.activeRelativePath = relativePath;
    // Switching the active tab resumes follow-mode (default lock to the visible tab).
    this.selectionFollowsActive = true;
    if (relativePath) {
      this.select(relativePath);
      const expanded = new Set(this.state.expandedRelativePaths);
      const segments = relativePath.split('/');
      segments.pop();
      for (let index = 1; index <= segments.length; index += 1) {
        expanded.add(segments.slice(0, index).join('/'));
      }
      this.updateState({ expandedRelativePaths: [...expanded] });
      void this.refreshChanged([...expanded, '']);
    } else {
      this.selectedRelativePath = null;
      this.selectedRelativePaths.clear();
      this.selectionAnchorRelativePath = null;
      this.render();
    }
  }

  /** Reveal in IndexArea: open the panel, expand parents, select and scroll to the node. */
  async revealRelativePath(relativePath: string): Promise<void> {
    if (!this.state?.rootPath) return;
    const expanded = new Set(this.state.expandedRelativePaths);
    const segments = relativePath.split('/');
    segments.pop();
    const parents: string[] = [];
    for (let index = 1; index <= segments.length; index += 1) parents.push(segments.slice(0, index).join('/'));
    parents.forEach((parent) => expanded.add(parent));
    this.updateState({ explorerVisible: true, expandedRelativePaths: [...expanded] });
    await Promise.all(['', ...parents].map((parent) => this.loadDirectory(parent)));
    this.selectionFollowsActive = true;
    this.select(relativePath);
    const row = [...this.options.container.querySelectorAll<HTMLElement>('.workspace-entry')]
      .find((element) => element.dataset.relativePath === relativePath);
    row?.scrollIntoView({ block: 'center' });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest('.easyview-timeline')) return;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f'
      && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.openSearch();
      return;
    }
    const action = resolveWorkspaceTreeKeyAction(event, {
      targetIsEditable: event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement,
      hasSelection: this.selectedRelativePaths.size > 0,
      hasPrimarySelection: this.selectedRelativePath !== null,
    });
    if (!action) return;
    event.preventDefault();
    if (action === 'rename' && this.selectedRelativePath) {
      this.beginRename(this.selectedRelativePath);
      return;
    }
    if (action === 'copy' && this.selectedRelativePath) {
      void this.options.api.workspace.copyClipboard(this.selectedRelativePath);
      return;
    }
    if (action === 'paste') {
      void this.pasteEntry(this.selectedRelativePath ?? '');
      return;
    }
    if (action === 'delete') void this.deleteEntries([...this.selectedRelativePaths]);
  };

  private async pasteEntry(targetRelativePath: string): Promise<void> {
    const result = await this.options.api.workspace.pasteClipboard({ targetRelativePath });
    if (!result.ok) return;
    this.selectedRelativePath = result.value.relativePath;
    await this.refreshChanged([parentRelativePath(result.value.relativePath)]);
    this.render();
  }

  private async loadDirectory(relativePath: string): Promise<void> {
    if (!this.state?.rootPath) return;
    const result = await this.options.api.workspace.readDirectory(relativePath);
    if (!result.ok) return;
    this.entriesByDirectory.set(relativePath, result.value);
    this.render();
  }

  private async refreshChanged(relativeDirectories: string[] | null): Promise<void> {
    if (!this.state?.rootPath) return;
    if (this.searchOpen) this.searchPanel?.refresh();
    if (relativeDirectories === null) {
      this.entriesByDirectory.clear();
      await this.refreshExpanded();
      return;
    }
    const expanded = new Set(['', ...this.state.expandedRelativePaths]);
    const targets = [...new Set(relativeDirectories.map(normalizeRelativePath))].filter((value) => expanded.has(value));
    await Promise.all(targets.map((relativePath) => this.loadDirectory(relativePath)));
  }

  private async refreshExpanded(): Promise<void> {
    if (!this.state?.rootPath) return;
    await Promise.all(['', ...this.state.expandedRelativePaths].map((relativePath) => this.loadDirectory(relativePath)));
  }

  private toggleDirectory(relativePath: string): void {
    if (!this.state) return;
    const expanded = new Set(this.state.expandedRelativePaths);
    if (expanded.has(relativePath)) expanded.delete(relativePath);
    else expanded.add(relativePath);
    this.updateState({ expandedRelativePaths: [...expanded] });
    if (expanded.has(relativePath)) void this.loadDirectory(relativePath);
  }

  private select(
    relativePath: string,
    options?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  ): void {
    const next = computeNextWorkspaceTreeSelection(
      { selected: this.selectedRelativePaths, anchor: this.selectionAnchorRelativePath },
      {
        target: relativePath,
        visible: this.visibleRelativePaths(),
        shiftKey: Boolean(options?.shiftKey),
        toggleKey: Boolean(options?.metaKey || options?.ctrlKey),
      },
    );
    this.selectedRelativePaths = new Set(next.selected);
    this.selectionAnchorRelativePath = next.anchor;
    this.selectedRelativePath = relativePath;
    this.options.container.focus({ preventScroll: true });
    this.render();
  }

  private visibleRelativePaths(): string[] {
    const expanded = new Set(this.state?.expandedRelativePaths ?? []);
    return collectVisibleWorkspaceTreeRelativePaths(this.entriesByDirectory, (path) => expanded.has(path));
  }

  private updateState(patch: Partial<DesktopWorkspaceState>): void {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.render();
    this.options.onStateChange(this.state);
    void this.options.api.workspace.setState(this.state);
  }

  private render(): void {
    const previousTree = this.options.container.querySelector<HTMLElement>('.workspace-tree');
    const scrollTop = previousTree?.scrollTop ?? 0, scrollLeft = previousTree?.scrollLeft ?? 0;
    this.renderTree();
    if (this.options.footer) this.options.container.append(this.options.footer);
    const tree = this.options.container.querySelector<HTMLElement>('.workspace-tree');
    if (tree) { tree.scrollTop = scrollTop; tree.scrollLeft = scrollLeft; }
    const relative = this.selectedRelativePath;
    const entry = this.entriesByDirectory.get(relative ? parentRelativePath(relative) : '')?.find((entry) => entry.relativePath === relative);
    this.options.onSelectionChanged?.(this.state?.rootPath && relative && entry?.kind !== 'directory' ? `${this.state.rootPath}/${relative}` : null, this.state?.explorerVisible ?? false);
  }

  private renderTree(): void {
    const { container } = this.options;
    const state = this.state;
    const previousTree = container.querySelector<HTMLElement>('.workspace-tree');
    const previousScrollTop = previousTree?.scrollTop ?? 0;
    const previousScrollLeft = previousTree?.scrollLeft ?? 0;
    this.clearDropVisuals();
    this.dropIndicator = null;
    this.hideTimestampTooltip();
    container.classList.toggle('is-hidden', !state?.explorerVisible);
    if (state) container.style.width = `${state.explorerWidth}px`;
    const searchFocused = this.searchPanel?.hasFocus() ?? false;
    container.replaceChildren();
    if (!state?.rootPath) {
      const empty = document.createElement('button');
      empty.type = 'button'; empty.className = 'workspace-empty'; empty.textContent = tExplorer('openFolder');
      empty.addEventListener('click', () => { void this.openFolder(); });
      container.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.className = 'workspace-header';
    const title = document.createElement('span');
    title.textContent = state.rootPath.split(/[\\/]/).at(-1) || state.rootPath;
    header.appendChild(title);
    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'workspace-action workspace-search-toggle';
    searchButton.classList.toggle('is-active', this.searchOpen);
    searchButton.title = tExplorer('search');
    searchButton.setAttribute('aria-pressed', String(this.searchOpen));
    searchButton.innerHTML = WORKSPACE_SEARCH_ICON_SVG;
    searchButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.searchOpen) this.closeSearch();
      else this.openSearch();
    });
    header.appendChild(searchButton);
    for (const [label, titleText, action] of [
      ['⇅', tExplorer('sort'), () => { this.sortMenuOpen = !this.sortMenuOpen; this.render(); }],
      ['＋', tExplorer('newFile'), () => this.beginCreate('', 'file')],
      ['▣', tExplorer('newFolder'), () => this.beginCreate('', 'directory')],
      ['↻', tExplorer('refresh'), () => { this.entriesByDirectory.clear(); void this.refreshExpanded(); }],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'workspace-action';
      button.textContent = label; button.title = titleText;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      header.appendChild(button);
    }
    container.appendChild(header);

    if (this.sortMenuOpen) {
      const menu = document.createElement('div');
      menu.className = 'workspace-sort-menu';
      const appendToggle = (iconId: WorkspaceTreeMenuIconId, text: string, checked: boolean, onClick: () => void) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'workspace-sort-menu-item';
        item.setAttribute('role', 'menuitemcheckbox');
        item.setAttribute('aria-checked', String(checked));
        const icon = document.createElement('span');
        icon.className = 'workspace-menu-item-icon';
        icon.innerHTML = workspaceTreeMenuIconSvg(iconId);
        item.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'workspace-menu-item-label';
        label.textContent = text;
        item.appendChild(label);
        const check = document.createElement('span');
        check.className = 'workspace-menu-item-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = checked ? '✓' : '';
        item.appendChild(check);
        item.addEventListener('click', onClick);
        menu.appendChild(item);
      };
      for (const mode of ['created', 'name', 'custom'] as const) {
        appendToggle(SORT_MODE_ICONS[mode], workspaceTreeSortModeLabel(mode), this.sortMode === mode, () => {
          void this.changeSortMode(mode);
        });
      }
      const separator = document.createElement('div');
      separator.className = 'workspace-sort-menu-separator';
      menu.appendChild(separator);
      appendToggle('showCreated', tExplorer('showCreatedTime'), this.showCreatedAt, () => {
        void this.changeShowCreatedAt(!this.showCreatedAt);
      });
      appendToggle('showUpdated', tExplorer('showUpdatedTime'), this.showUpdatedAt, () => {
        void this.changeShowUpdatedAt(!this.showUpdatedAt);
      });
      appendToggle('showTimeOnHover', tExplorer('showTimeOnHover'), this.showTimestampHover, () => {
        void this.changeShowTimestampHover(!this.showTimestampHover);
      });
      const dotSeparator = document.createElement('div');
      dotSeparator.className = 'workspace-sort-menu-separator';
      menu.appendChild(dotSeparator);
      appendToggle('showDotEntries', tExplorer('showDotEntries'), this.showDotEntries, () => {
        void this.changeShowDotEntries(!this.showDotEntries);
      });
      container.appendChild(menu);
    }

    if (this.searchOpen && this.searchPanel) {
      container.appendChild(this.searchPanel.element);
      if (searchFocused) this.searchPanel.focus();
      if (this.searchPanel.hasQuery) {
        this.appendResizer(container);
        return;
      }
    }

    const tree = document.createElement('div');
    tree.className = 'workspace-tree';
    tree.setAttribute('role', 'tree');
    tree.appendChild(this.renderDirectory('', 0));
    tree.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.workspace-entry, .workspace-create-row')) return;
      this.selectionFollowsActive = false;
      this.options.container.focus({ preventScroll: true });
      if (this.selectedRelativePaths.size === 0 && this.selectedRelativePath === null) return;
      this.selectedRelativePath = null;
      this.selectedRelativePaths.clear();
      this.selectionAnchorRelativePath = null;
      this.render();
    });
    container.appendChild(tree);
    tree.scrollTop = previousScrollTop;
    tree.scrollLeft = previousScrollLeft;
    this.appendResizer(container);
  }

  private appendResizer(container: HTMLElement): void {
    const resizer = document.createElement('div');
    resizer.className = 'workspace-resizer';
    resizer.addEventListener('pointerdown', (event) => this.beginResize(event));
    container.appendChild(resizer);
  }

  openSearch(): void {
    if (!this.state?.rootPath) return;
    this.searchPanel ??= new WorkspaceSearchPanel({
      search: async (query) => {
        const result = await this.options.api.workspace.search(query);
        return result.ok ? result.value : null;
      },
      onOpen: (entry) => { void this.openSearchResult(entry); },
      onClose: () => this.closeSearch(),
      onQueryActiveChange: () => this.render(),
    });
    this.sortMenuOpen = false;
    if (!this.state.explorerVisible) this.updateState({ explorerVisible: true });
    this.searchOpen = true;
    this.render();
    this.searchPanel.focus(true);
  }

  private closeSearch(): void {
    if (!this.searchOpen) return;
    this.searchOpen = false;
    this.searchPanel?.reset();
    this.render();
    this.options.container.focus({ preventScroll: true });
    this.options.container.querySelector('.workspace-entry.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private async openSearchResult(entry: WorkspaceEntry): Promise<void> {
    if (entry.kind === 'directory') {
      this.closeSearch();
      await this.revealRelativePath(entry.relativePath);
      if (!this.state?.expandedRelativePaths.includes(entry.relativePath)) this.toggleDirectory(entry.relativePath);
      return;
    }
    const opened = await this.options.onOpenFile(entry.relativePath);
    if (!opened) return;
    this.selectionFollowsActive = true;
    this.setActiveRelativePath(entry.relativePath);
  }

  private renderDirectory(relativePath: string, depth: number): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const entries = filterWorkspaceEntriesByDotVisibility(
      this.entriesByDirectory.get(relativePath) ?? [],
      this.showDotEntries,
    );
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = `workspace-entry workspace-entry-${entry.kind}`;
      row.dataset.relativePath = entry.relativePath;
      row.dataset.kind = entry.kind;
      row.style.paddingInlineStart = `${8 + depth * 16}px`;
      row.classList.toggle('active', entry.relativePath === this.activeRelativePath);
      row.classList.toggle('selected', this.selectedRelativePaths.has(entry.relativePath));
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(this.selectedRelativePaths.has(entry.relativePath)));
      const expanded = entry.kind === 'directory' && Boolean(this.state?.expandedRelativePaths.includes(entry.relativePath));
      if (entry.kind === 'directory') row.setAttribute('aria-expanded', String(expanded));

      const name = document.createElement('button');
      name.type = 'button'; name.className = 'workspace-entry-name';
      const chevron = document.createElement('span');
      chevron.className = 'workspace-chevron';
      if (entry.kind === 'directory') {
        chevron.classList.add('is-directory');
        chevron.classList.toggle('is-expanded', expanded);
      } const icon = document.createElement('span');
      icon.className = 'workspace-entry-icon';
      const iconDesc = resolveWorkspaceTreeIcon({
        kind: entry.kind,
        name: entry.name,
        expanded: entry.kind === 'directory' ? expanded : false,
      });
      icon.dataset.icon = iconDesc.id;
      icon.innerHTML = iconDesc.svg;
      name.append(chevron, icon);
      if (this.renameRelativePath === entry.relativePath) name.appendChild(this.renderRenameInput(entry));
      else {
        const label = document.createElement('span'); label.textContent = entry.name; name.appendChild(label);
      }
      name.addEventListener('click', (event) => {
        this.selectionFollowsActive = false;
        this.select(entry.relativePath, {
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        });
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        if (entry.kind === 'directory') this.toggleDirectory(entry.relativePath);
        else {
          void this.options.onOpenFile(entry.relativePath).then((opened) => {
            if (!opened) return;
            // Opening from the tree should lock selection to that file again.
            this.selectionFollowsActive = true;
            this.setActiveRelativePath(entry.relativePath);
          });
        }
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.selectionFollowsActive = false;
        if (!this.selectedRelativePaths.has(entry.relativePath)) this.select(entry.relativePath);
        void this.options.api.workspace.showContextMenu(entry.relativePath, entry.kind);
      });
      this.attachDragHandlers(row, entry);
      row.appendChild(name);
      this.appendEntryTimestamps(row, entry);
      if (entry.kind === 'directory') {
        const create = document.createElement('button');
        create.type = 'button'; create.className = 'workspace-entry-create'; create.textContent = '＋'; create.title = tExplorer('newFile');
        create.addEventListener('click', (event) => { event.stopPropagation(); this.beginCreate(entry.relativePath, 'file'); });
        row.appendChild(create);
      } else if (this.showCreatedAt || this.showUpdatedAt) {
        const spacer = document.createElement('span');
        spacer.className = 'workspace-entry-create-spacer';
        row.appendChild(spacer);
      }
      fragment.appendChild(row);
      if (entry.kind === 'directory' && expanded) fragment.appendChild(this.renderDirectory(entry.relativePath, depth + 1));
    }
    if (this.pendingCreate?.parentRelativePath === relativePath) fragment.appendChild(this.renderCreateInput(depth));
    return fragment;
  }

  private appendEntryTimestamps(row: HTMLElement, entry: WorkspaceEntry): void {
    const display = describeWorkspaceEntryTimestamps(entry, {
      showCreatedAt: this.showCreatedAt,
      showUpdatedAt: this.showUpdatedAt,
    });
    if (!display) return;
    if (this.showTimestampHover) {
      row.addEventListener('pointerenter', (event) => {
        this.showTimestampTooltip(display.title, event.clientX, event.clientY);
      });
      row.addEventListener('pointerleave', () => this.hideTimestampTooltip());
    }
    if (display.parts.length === 0) return;
    row.classList.add('has-timestamps');
    const meta = document.createElement('span');
    meta.className = 'workspace-entry-timestamps';
    for (const part of display.parts) {
      const item = document.createElement('span');
      item.className = `workspace-entry-timestamp is-${part.kind}`;
      const icon = document.createElement('span');
      icon.className = `workspace-entry-timestamp-icon is-${part.kind}`;
      icon.setAttribute('aria-hidden', 'true');
      const value = document.createElement('span');
      value.className = 'workspace-entry-timestamp-value';
      value.textContent = part.value;
      item.append(icon, value);
      meta.appendChild(item);
    }
    row.appendChild(meta);
  }

  private showTimestampTooltip(text: string, x: number, y: number): void {
    const el = this.timestampTooltipEl ?? document.createElement('div');
    if (!this.timestampTooltipEl) {
      el.className = 'workspace-timestamp-tooltip';
      document.body.appendChild(el);
      this.timestampTooltipEl = el;
    }
    el.textContent = text;
    el.hidden = false;
    const pad = 8;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let left = x + 12;
    let top = y + 16;
    if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - width - pad);
    if (top + height > window.innerHeight - pad) top = Math.max(pad, y - height - 12);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private hideTimestampTooltip(): void {
    if (this.timestampTooltipEl) this.timestampTooltipEl.hidden = true;
  }

  private renderRenameInput(entry: WorkspaceEntry): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'workspace-rename-input';
    input.value = entry.name;
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { this.renameRelativePath = null; this.render(); }
      if (event.key === 'Enter') { event.preventDefault(); void this.renameEntry(entry.relativePath, input.value); }
    });
    input.addEventListener('blur', () => { if (this.renameRelativePath === entry.relativePath) void this.renameEntry(entry.relativePath, input.value); });
    requestAnimationFrame(() => {
      // Editing may already have started before this frame (focus, select-all, typing).
      // Re-applying the stem selection then would replace only the stem and keep the
      // extension, turning "new.md" into "new.md.md".
      if (!input.isConnected || document.activeElement === input) return;
      input.focus();
      input.setSelectionRange(...workspaceEntryNameSelectionRange(input.value));
    });
    return input;
  }

  private beginRename(relativePath: string): void {
    this.pendingCreate = null;
    this.renameRelativePath = relativePath;
    this.render();
  }

  private async renameEntry(relativePath: string, newName: string): Promise<void> {
    if (this.renameRelativePath !== relativePath) return;
    this.renameRelativePath = null;
    const result = await this.options.api.workspace.rename({ relativePath, newName: newName.trim() });
    if (!result.ok) { window.alert(result.message); this.render(); return; }
    this.selectedRelativePaths.delete(relativePath);
    this.selectedRelativePaths.add(result.value.relativePath);
    this.selectedRelativePath = result.value.relativePath;
    this.selectionAnchorRelativePath = result.value.relativePath;
    await this.loadDirectory(parentRelativePath(result.value.relativePath));
  }

  private async deleteEntry(relativePath: string): Promise<void> {
    await this.deleteEntries([relativePath]);
  }

  private async deleteEntries(relativePaths: string[]): Promise<void> {
    const unique = [...new Set(relativePaths.filter(Boolean))];
    for (const relativePath of unique) {
      const result = await this.options.api.workspace.delete({ relativePath });
      if (!result.ok && result.code !== 'CANCELLED') window.alert(result.message);
      if (result.ok) {
        this.selectedRelativePaths.delete(relativePath);
        if (this.selectedRelativePath === relativePath) this.selectedRelativePath = null;
        if (this.selectionAnchorRelativePath === relativePath) this.selectionAnchorRelativePath = null;
      }
    }
    this.render();
  }

  private relativePathFor(filePath: string | null): string | null {
    return this.state?.rootPath && filePath ? workspaceRelativePath(this.state.rootPath, filePath) : null;
  }

  private beginCreate(parentRelativePath: string, kind: 'file' | 'directory'): void {
    if (!this.state) return;
    const expanded = new Set(this.state.expandedRelativePaths);
    if (parentRelativePath) expanded.add(parentRelativePath);
    this.renameRelativePath = null;
    this.pendingCreate = { parentRelativePath, kind };
    this.updateState({ expandedRelativePaths: [...expanded] });
    if (parentRelativePath) void this.loadDirectory(parentRelativePath);
  }

  private renderCreateInput(depth: number): HTMLElement {
    const wrapper = document.createElement('form');
    wrapper.className = 'workspace-create-row'; wrapper.style.paddingInlineStart = `${28 + depth * 16}px`;
    const input = document.createElement('input');
    input.autofocus = true; input.value = this.pendingCreate?.kind === 'file' ? 'untitled.md' : 'untitled';
    wrapper.appendChild(input);
    wrapper.addEventListener('submit', (event) => { event.preventDefault(); const pending = this.pendingCreate; if (pending) void this.createEntry(pending, input.value); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { this.pendingCreate = null; this.render(); } });
    requestAnimationFrame(() => input.select());
    return wrapper;
  }

  private async createEntry(pending: NonNullable<WorkspaceExplorer['pendingCreate']>, name: string): Promise<void> {
    const result = await this.options.api.workspace.create({ parentRelativePath: pending.parentRelativePath, name, kind: pending.kind });
    if (!result.ok) { window.alert(result.message); return; }
    this.pendingCreate = null;
    this.selectedRelativePath = result.value.relativePath;
    await this.loadDirectory(pending.parentRelativePath);
  }

  private beginResize(event: PointerEvent): void {
    if (!this.state) return;
    event.preventDefault(); this.resizing = true;
    const onMove = (moveEvent: PointerEvent) => {
      if (!this.resizing) return;
      this.updateState({ explorerWidth: Math.max(220, Math.min(520, Math.round(moveEvent.clientX))) });
    };
    const onEnd = () => { this.resizing = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onEnd); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onEnd);
  }

  private async loadSortMode(): Promise<void> {
    const [sortResult, createdResult, updatedResult, hoverResult, dotResult] = await Promise.all([
      this.options.api.workspace.getSortMode(),
      this.options.api.workspace.getShowCreatedAt(),
      this.options.api.workspace.getShowUpdatedAt(),
      this.options.api.workspace.getShowTimestampHover(),
      this.options.api.workspace.getShowDotEntries(),
    ]);
    if (sortResult.ok) this.sortMode = sortResult.value;
    if (createdResult.ok) this.showCreatedAt = createdResult.value;
    if (updatedResult.ok) this.showUpdatedAt = updatedResult.value;
    if (hoverResult.ok) this.showTimestampHover = hoverResult.value;
    if (dotResult.ok) this.showDotEntries = dotResult.value;
  }

  private async changeSortMode(sortMode: WorkspaceTreeSortMode): Promise<void> {
    this.sortMenuOpen = false;
    if (sortMode === this.sortMode) {
      this.render();
      return;
    }
    const result = await this.options.api.workspace.setSortMode(sortMode);
    if (!result.ok) {
      window.alert(result.message);
      this.render();
      return;
    }
    this.sortMode = result.value;
    this.entriesByDirectory.clear();
    await this.refreshExpanded();
  }

  private async changeShowCreatedAt(showCreatedAt: boolean): Promise<void> {
    this.sortMenuOpen = false;
    const result = await this.options.api.workspace.setShowCreatedAt(showCreatedAt);
    if (!result.ok) {
      window.alert(result.message);
      this.render();
      return;
    }
    this.showCreatedAt = result.value;
    this.render();
  }

  private async changeShowUpdatedAt(showUpdatedAt: boolean): Promise<void> {
    this.sortMenuOpen = false;
    const result = await this.options.api.workspace.setShowUpdatedAt(showUpdatedAt);
    if (!result.ok) {
      window.alert(result.message);
      this.render();
      return;
    }
    this.showUpdatedAt = result.value;
    this.render();
  }

  private async changeShowTimestampHover(showTimestampHover: boolean): Promise<void> {
    this.sortMenuOpen = false;
    this.hideTimestampTooltip();
    const result = await this.options.api.workspace.setShowTimestampHover(showTimestampHover);
    if (!result.ok) {
      window.alert(result.message);
      this.render();
      return;
    }
    this.showTimestampHover = result.value;
    this.render();
  }

  private async changeShowDotEntries(showDotEntries: boolean): Promise<void> {
    this.sortMenuOpen = false;
    const result = await this.options.api.workspace.setShowDotEntries(showDotEntries);
    if (!result.ok) {
      window.alert(result.message);
      this.render();
      return;
    }
    this.showDotEntries = result.value;
    this.render();
  }

  private attachDragHandlers(row: HTMLElement, entry: WorkspaceEntry): void {
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      this.dragRelativePath = entry.relativePath;
      event.dataTransfer?.setData('text/plain', entry.relativePath);
      event.dataTransfer!.effectAllowed = 'move';
      row.classList.add('is-dragging');
      this.clearDropVisuals();
    });
    row.addEventListener('dragend', () => {
      this.dragRelativePath = null;
      row.classList.remove('is-dragging');
      this.clearDropVisuals();
    });
    row.addEventListener('dragover', (event) => {
      const external = isExternalWorkspaceFileDrag(event.dataTransfer, this.dragRelativePath !== null);
      if (!external && (!this.dragRelativePath || this.dragRelativePath === entry.relativePath)) return;
      const target = this.resolveDropTarget(row, event, external);
      if (!target) {
        this.clearDropVisuals();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer!.dropEffect = external ? 'copy' : 'move';
      this.dropIntent = { targetRelativePath: entry.relativePath, target };
      this.renderDropVisuals(target);
    });
    row.addEventListener('dragleave', (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && row.contains(related)) return;
      if (this.dropIntent?.targetRelativePath === entry.relativePath) {
        this.clearDropVisuals();
      }
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const external = isExternalWorkspaceFileDrag(event.dataTransfer, this.dragRelativePath !== null);
      const intent = this.dropIntent;
      const target = intent?.targetRelativePath === entry.relativePath
        ? intent.target
        : this.resolveDropTarget(row, event, external);
      this.clearDropVisuals();
      if (!target) return;
      if (external && event.dataTransfer) {
        void this.importExternalDrop(
          event.dataTransfer,
          target.kind === 'into' ? target.relativePath : target.placement.parentRelativePath,
        );
        return;
      }
      const source = this.dragRelativePath ?? event.dataTransfer?.getData('text/plain');
      if (!source) return;
      void this.handleDrop(source, target);
    });
  }

  private treeRows(): HTMLElement[] {
    return [...this.options.container.querySelectorAll<HTMLElement>('.workspace-tree .workspace-entry')];
  }

  private resolveDropTarget(row: HTMLElement, event: DragEvent, external: boolean): WorkspaceTreeDropTarget | null {
    const rows = this.treeRows();
    const rect = row.getBoundingClientRect();
    const kind = (row.dataset.kind ?? 'file') as WorkspaceEntry['kind'];
    return resolveWorkspaceTreeDropTarget({
      rows: rows.map((element) => ({
        relativePath: element.dataset.relativePath ?? '',
        kind: (element.dataset.kind ?? 'file') as WorkspaceEntry['kind'],
      })),
      index: rows.indexOf(row),
      zone: resolveWorkspaceTreeRowDropZone(kind, event.clientY, rect.top, rect.height),
      pointerDepth: workspaceTreeDepthFromPointer(event.clientX - rect.left),
      draggedRelativePath: external ? null : this.dragRelativePath,
    });
  }

  private renderDropVisuals(target: WorkspaceTreeDropTarget): void {
    this.options.container.querySelectorAll('.workspace-entry.is-drop-into').forEach((node) => {
      node.classList.remove('is-drop-into');
    });
    if (!this.dropIndicator) {
      this.dropIndicator = document.createElement('div');
      this.dropIndicator.className = 'workspace-drop-indicator';
      this.options.container.appendChild(this.dropIndicator);
    }
    const rows = this.treeRows();

    if (target.kind === 'into') {
      this.dropIndicator.classList.remove('is-visible');
      rows.find((element) => element.dataset.relativePath === target.relativePath)?.classList.add('is-drop-into');
      return;
    }

    const lineRow = rows[target.lineRowIndex];
    const tree = this.options.container.querySelector('.workspace-tree');
    if (!lineRow || !tree) return;
    const containerRect = this.options.container.getBoundingClientRect();
    const rowRect = lineRow.getBoundingClientRect();
    const treeRect = tree.getBoundingClientRect();
    // The line starts at the target level's indent so the user can see which folder receives the drop.
    const left = rowRect.left - containerRect.left + workspaceTreeDropLineOffset(target.placement.depth);
    const right = treeRect.left - containerRect.left + tree.clientWidth - 8;
    const edge = target.lineEdge === 'top' ? rowRect.top : rowRect.bottom;
    this.dropIndicator.style.left = `${Math.max(0, left)}px`;
    this.dropIndicator.style.width = `${Math.max(24, right - left)}px`;
    this.dropIndicator.style.top = `${edge - containerRect.top - 1}px`;
    this.dropIndicator.classList.add('is-visible');
  }

  private clearDropVisuals(): void {
    window.clearTimeout(this.dropHoverExpandTimer);
    this.dropHoverExpandTimer = undefined;
    this.dropIntent = null;
    this.options.container.querySelectorAll('.workspace-entry.is-drop-into, .workspace-entry.is-drop-target').forEach((node) => {
      node.classList.remove('is-drop-into', 'is-drop-target');
    });
    if (this.dropIndicator) this.dropIndicator.classList.remove('is-visible');
  }

  private readonly handleContainerDragOver = (event: DragEvent): void => {
    if (!this.state?.rootPath || !isExternalWorkspaceFileDrag(event.dataTransfer, this.dragRelativePath !== null)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  private readonly handleContainerDrop = (event: DragEvent): void => {
    if (!this.state?.rootPath || !event.dataTransfer) return;
    if (!isExternalWorkspaceFileDrag(event.dataTransfer, this.dragRelativePath !== null)) return;
    event.preventDefault();
    this.clearDropVisuals();
    void this.importExternalDrop(event.dataTransfer, '');
  };

  private async importExternalDrop(dataTransfer: DataTransfer, targetParentRelativePath: string): Promise<void> {
    if (!this.state?.rootPath) return;
    const sources = await collectWorkspaceExternalDropSources(dataTransfer);
    const items = sources.items.map((item) => ({
      kind: item.kind,
      relativePath: item.relativePath,
      ...(item.bytes ? { dataBase64: bytesToBase64(item.bytes) } : {}),
    }));
    if (sources.sourcePaths.length === 0 && sources.sourceUris.length === 0 && items.length === 0) return;
    const result = await this.options.api.workspace.importExternal({
      targetParentRelativePath,
      sourcePaths: sources.sourcePaths,
      sourceUris: sources.sourceUris,
      items,
    });
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    this.selectedRelativePath = result.value.relativePath;
    this.selectedRelativePaths = new Set([result.value.relativePath]);
    this.selectionAnchorRelativePath = result.value.relativePath;
    if (targetParentRelativePath && this.state) {
      const expanded = new Set(this.state.expandedRelativePaths);
      expanded.add(targetParentRelativePath);
      this.updateState({ expandedRelativePaths: [...expanded] });
    }
    await this.refreshChanged([targetParentRelativePath]);
    this.render();
  }

  private async handleDrop(
    sourceRelativePath: string,
    dropTarget: WorkspaceTreeDropTarget,
  ): Promise<void> {
    const sourceParent = parentRelativePath(sourceRelativePath);
    const sourceName = sourceRelativePath.split('/').at(-1)!;

    if (dropTarget.kind === 'into') {
      const target = { relativePath: dropTarget.relativePath };
      if (
        sourceRelativePath === target.relativePath
        || target.relativePath.startsWith(`${sourceRelativePath}/`)
      ) {
        window.alert(tExplorer('moveIntoSelf'));
        return;
      }
      if (sourceParent === target.relativePath) {
        // Already inside: treat as reorder to end is not requested; no-op.
        return;
      }
      const result = await this.options.api.workspace.move({
        relativePath: sourceRelativePath,
        targetParentRelativePath: target.relativePath,
      });
      if (!result.ok) {
        window.alert(result.message);
        return;
      }
      if (this.sortMode !== 'custom') {
        // Moving into a folder should flip to custom so the new sibling order can be kept.
        await this.options.api.workspace.setSortMode('custom');
        this.sortMode = 'custom';
      }
      const siblings = (this.entriesByDirectory.get(target.relativePath) ?? [])
        .map((entry) => entry.name)
        .filter((name) => name !== sourceName);
      siblings.push(result.value.name);
      await this.options.api.workspace.reorder({
        parentRelativePath: target.relativePath,
        movedName: result.value.name,
        siblingNames: siblings,
      });
      const expanded = new Set(this.state?.expandedRelativePaths ?? []);
      expanded.add(target.relativePath);
      this.updateState({ expandedRelativePaths: [...expanded] });
      await this.refreshChanged([sourceParent, target.relativePath]);
      return;
    }

    const { placement } = dropTarget;
    const targetParent = placement.parentRelativePath;
    const siblingNames = (this.entriesByDirectory.get(targetParent) ?? []).map((entry) => entry.name);
    const beforeName = workspaceTreeGapBeforeName(placement, siblingNames);
    if (sourceParent === targetParent) {
      await this.reorderBefore(sourceParent, sourceName, beforeName);
      return;
    }

    const result = await this.options.api.workspace.move({
      relativePath: sourceRelativePath,
      targetParentRelativePath: targetParent,
    });
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    if (this.sortMode !== 'custom') {
      await this.options.api.workspace.setSortMode('custom');
      this.sortMode = 'custom';
    }
    const siblings = [...siblingNames];
    if (!siblings.includes(result.value.name)) siblings.push(result.value.name);
    await this.options.api.workspace.reorder({
      parentRelativePath: targetParent,
      movedName: result.value.name,
      siblingNames: siblings,
      beforeName,
    });
    if (targetParent && this.state && !this.state.expandedRelativePaths.includes(targetParent)) {
      this.updateState({ expandedRelativePaths: [...this.state.expandedRelativePaths, targetParent] });
    }
    await this.refreshChanged([sourceParent, targetParent]);
  }

  /** `beforeName` undefined appends to the end of the folder. */
  private async reorderBefore(parentRelativePathValue: string, movedName: string, beforeName: string | undefined): Promise<void> {
    if (movedName === beforeName) return;
    const siblings = (this.entriesByDirectory.get(parentRelativePathValue) ?? []).map((entry) => entry.name);
    // Dropping right after itself (or at the end while already last) keeps the current order.
    const index = siblings.indexOf(movedName);
    if (index >= 0 && siblings[index + 1] === beforeName) return;
    if (this.sortMode !== 'custom') {
      const sortResult = await this.options.api.workspace.setSortMode('custom');
      if (!sortResult.ok) {
        window.alert(sortResult.message);
        return;
      }
      this.sortMode = 'custom';
    }
    const result = await this.options.api.workspace.reorder({
      parentRelativePath: parentRelativePathValue,
      movedName,
      siblingNames: siblings,
      beforeName,
    });
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    await this.loadDirectory(parentRelativePathValue);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function workspaceRelativePath(rootPath: string, targetPath: string): string | null {
  const root = rootPath.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const target = targetPath.replace(/\\/g, '/');
  if (!target.startsWith(`${root}/`)) return null;
  return target.slice(root.length + 1);
}
