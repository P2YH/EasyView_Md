import type { GuardClient, GuardCommit, GuardFile, GuardHistory, GuardRepository, GuardRequest, GuardStatus, GuardUiState } from '@easyview/contracts';
import { tGuard } from './guard.i18n';
export interface GuardPanelOptions { client: GuardClient; close?(): void; grip?: string }
export class VersionGuardPanel {
  readonly element = document.createElement('section');
  private readonly body = document.createElement('div');
  private readonly footer = document.createElement('div');
  private readonly notice = document.createElement('div');
  private readonly resizeHandle = document.createElement('div');
  private readonly refresh: HTMLButtonElement;
  private repositories: GuardRepository[] = [];
  private statuses = new Map<string, GuardStatus>();
  private stale = new Set<string>();
  private pending = new Set<string>();
  private ui: GuardUiState;
  private visible = false;
  private scanning = false;
  private scanWarnings: string[] = [];
  private discoverySubscription?: { dispose(): void };
  private disposed = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private lastRefresh = new Map<string, number>();
  private histories = new Map<string, GuardHistory>();
  private selectedCommit?: GuardCommit;
  private collapsedDirs = new Set<string>();
  private commitFiles = new Map<string, GuardFile[]>();
  private historyKey?: string;
  private historyCollapsed = false;
  private subscription: { dispose(): void };
  constructor(private readonly options: GuardPanelOptions) {
    this.ui = options.client.loadState() ?? { expanded: [], drafts: {} };
    this.element.className = 'version-guard';
    installStyles();
    const header = document.createElement('header');
    if (options.grip) { const grip = document.createElement('span'); grip.dataset.dockGrip = options.grip; grip.className = 'guard-grip'; grip.textContent = '⠿'; header.append(grip); }
    const title = document.createElement('strong'); title.textContent = tGuard('title'); header.append(title);
    this.refresh = this.button('↻', tGuard('refresh'), () => this.scanning ? this.cancelScan() : this.scan()); header.append(this.refresh);
    if (options.close) header.append(this.button('×', tGuard('close'), options.close));
    this.notice.className = 'guard-notice'; this.notice.setAttribute('role', 'status');
    this.body.className = 'guard-repositories'; this.footer.className = 'guard-history';
    this.footer.style.height = `${this.ui.historyHeight ?? 240}px`;
    const resize = this.resizeHandle; resize.className = 'guard-history-resize';
    resize.onpointerdown = event => {
      event.preventDefault(); const start = event.clientY; const height = this.footer.getBoundingClientRect().height;
      const move = (e: PointerEvent) => { this.ui.historyHeight = Math.max(100, Math.min(600, height + start - e.clientY)); this.footer.style.height = `${this.ui.historyHeight}px`; };
      const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); this.persist(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
    };
    this.element.append(header, this.notice, this.body, resize, this.footer);
    this.subscription = options.client.subscribe(paths => this.invalidate(paths));
    this.discoverySubscription = options.client.onDiscovery?.((repositories, warnings) => {
      if (!this.scanning) return;
      this.repositories = repositories; this.scanWarnings = warnings;
      if (!this.ui.selected) this.ui.selected = repositories[0]?.id;
      this.notice.textContent = `${tGuard('scanning')} (${repositories.length})${warnings.length ? `\n${warnings.join('\n')}` : ''}`;
      this.render();
    });
    window.addEventListener('focus', this.onFocus); window.addEventListener('blur', this.onBlur);
  }
  private onFocus = (): void => { if (this.visible) { void this.options.client.request({ method: 'active', active: true }).catch(error => this.error(error)); this.schedule(); } };
  private onBlur = (): void => { if (this.timer) clearTimeout(this.timer); this.timer = undefined; if (this.visible) void this.options.client.request({ method: 'active', active: false }).catch(error => this.error(error)); };
  setVisible(visible: boolean): void {
    if (this.visible === visible) return; this.visible = visible;
    void this.options.client.request({ method: 'active', active: visible && document.hasFocus() }).catch(error => this.error(error));
    if (!visible) { if (this.scanning) this.cancelScan(); if (this.timer) clearTimeout(this.timer); this.timer = undefined; return; }
    if (!this.repositories.length) void this.scan();
    else { this.repositories.forEach(repo => this.stale.add(repo.id)); this.schedule(); }
  }
  reset(): void { if (this.scanning) this.cancelScan(); this.generation++; this.repositories = []; this.statuses.clear(); this.histories.clear(); this.commitFiles.clear(); this.historyKey = undefined; this.pending.clear(); this.selectedCommit = undefined; if (this.visible) void this.scan(); else this.render(); }
  private cancelScan(): void { this.generation++; this.scanning = false; this.refresh.textContent = '↻'; this.refresh.title = tGuard('refresh'); this.refresh.setAttribute('aria-label', tGuard('refresh')); this.notice.textContent = this.scanWarnings.join('\n'); void this.options.client.request({ method: 'cancel' }).catch(error => this.error(error)); }
  private persist(): void { this.options.client.saveState(this.ui); }
  private error(error: unknown): void { this.notice.textContent = error instanceof Error ? error.message : String(error); this.notice.classList.add('is-error'); }
  private button(label: string, title: string, action: () => void | Promise<unknown>): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
    button.onclick = event => { event.stopPropagation(); void Promise.resolve().then(action).catch(error => this.error(error)); }; return button;
  }
  private async scan(): Promise<void> {
    if (this.scanning) return; const generation = ++this.generation; this.scanning = true; this.scanWarnings = []; this.refresh.textContent = '×'; this.refresh.title = tGuard('cancel'); this.refresh.setAttribute('aria-label', tGuard('cancel'));
    this.notice.classList.remove('is-error'); this.notice.textContent = tGuard('scanning');
    try {
      const repos = await this.options.client.request({ method: 'discover' }) as GuardRepository[];
      if (this.disposed || generation !== this.generation) return;
      this.repositories = repos; this.statuses.clear(); this.histories.clear();
      if (!repos.some(repo => repo.id === this.ui.selected)) this.ui.selected = repos[0]?.id;
      if (!this.ui.expanded.length && repos[0]) this.ui.expanded = [repos[0].id];
      this.notice.textContent = this.scanWarnings.join('\n'); this.render();
      // Initial summaries are bounded by the host-wide Git command limiter.
      for (const repo of repos) { if (!this.visible || this.disposed || generation !== this.generation) break; await this.loadStatus(repo.id, generation); }
      await this.loadHistory();
    } catch (error) { if (generation === this.generation) this.error(error); }
    finally { if (generation === this.generation) { this.scanning = false; this.refresh.textContent = '↻'; this.refresh.title = tGuard('refresh'); this.refresh.setAttribute('aria-label', tGuard('refresh')); this.render(); } }
  }
  invalidate(paths: string[] | null): void {
    for (const repo of this.repositories) if (!paths || paths.some(file => file === repo.rootPath || file.startsWith(`${repo.rootPath}/`) || repo.rootPath.startsWith(`${file}/`))) { this.stale.add(repo.id); }
    this.render(); this.schedule();
  }
  private schedule(): void {
    if (!this.visible || !document.hasFocus() || this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.updateStale(); }, 800);
  }
  private async updateStale(): Promise<void> {
    for (const id of this.stale) {
      if (!this.ui.expanded.includes(id) && id !== this.ui.selected) continue;
      if (Date.now() - (this.lastRefresh.get(id) ?? 0) < 3000) { this.schedule(); continue; }
      await this.loadStatus(id);
    }
  }
  private async loadStatus(id: string, generation = this.generation): Promise<void> {
    if (this.pending.has(id)) return;
    this.pending.add(id); this.stale.delete(id); this.lastRefresh.set(id, Date.now());
    try {
      const status = await this.options.client.request({ method: 'status', repository: id }) as GuardStatus;
      if (this.disposed || generation !== this.generation) return;
      if (this.statuses.get(id)?.head !== status.head) this.histories.delete(id);
      this.statuses.set(id, status); this.render(); if (id === this.ui.selected) await this.loadHistory();
    } catch (error) { this.error(error); }
    finally { this.pending.delete(id); this.render(); }
  }
  private async operation(id: string, request: Omit<GuardRequest, 'repository'>): Promise<void> {
    if (this.pending.has(id)) return;
    this.pending.add(id); this.notice.textContent = ''; this.notice.classList.remove('is-error'); this.render();
    try { await this.options.client.request({ ...request, repository: id }); if (request.method === 'commit') { this.ui.drafts[id] = ''; this.persist(); this.histories.delete(id); } }
    finally { this.pending.delete(id); await this.loadStatus(id); }
  }
  private render(): void {
    if (this.disposed) return;
    // Preserve text input selection while status updates arrive.
    const input = document.activeElement instanceof HTMLTextAreaElement && this.body.contains(document.activeElement) ? document.activeElement : null;
    const selection = input ? { id: input.dataset.repository, start: input.selectionStart, end: input.selectionEnd } : null;
    this.body.replaceChildren();
    if (!this.repositories.length && !this.scanning) this.body.textContent = tGuard('empty');
    for (const repo of this.repositories) {
      const section = document.createElement('section'); section.className = 'guard-repository'; section.dataset.repository = repo.id;
      const depth = this.repositories.filter(other => other !== repo && repo.rootPath.startsWith(`${other.rootPath}/`)).length;
      if (depth) { section.style.setProperty('--guard-depth', String(depth)); section.classList.add('is-nested'); }
      const expanded = this.ui.expanded.includes(repo.id);
      const loading = this.pending.has(repo.id) || (this.scanning && !this.statuses.has(repo.id));
      const row = document.createElement('div'); row.className = `guard-repo-title${this.ui.selected === repo.id ? ' is-selected' : ''}${loading ? ' is-loading' : ''}`; row.title = repo.rootPath;
      row.tabIndex = 0; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-expanded', String(expanded)); if (loading) row.setAttribute('aria-busy', 'true');
      // The whole header row toggles expansion and selects the repository, like a tree node.
      const toggle = (): void => { if (this.ui.selected !== repo.id) { this.ui.selected = repo.id; this.selectedCommit = undefined; } this.ui.expanded = expanded ? this.ui.expanded.filter(id => id !== repo.id) : [...this.ui.expanded, repo.id]; this.persist(); this.render(); if (!expanded || this.ui.selected === repo.id) void this.loadStatus(repo.id); };
      row.onclick = toggle; row.onkeydown = event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(); } };
      const twisty = document.createElement('span'); twisty.className = 'guard-twisty'; twisty.innerHTML = expanded ? ICONS.chevronDown : ICONS.chevronRight;
      const name = document.createElement('span'); name.className = 'guard-repo-name'; name.textContent = repo.name; row.append(twisty, name);
      const status = this.statuses.get(repo.id); const branch = document.createElement('span'); branch.className = 'guard-branch'; branch.textContent = status ? `${status.branch}  ↑${status.ahead} ↓${status.behind} · ${status.files.length}` : '…'; row.append(branch);
      if (this.stale.has(repo.id)) { const badge = document.createElement('span'); badge.textContent = '•'; badge.title = tGuard('stale'); row.append(badge); }
      section.append(row);
      if (expanded && status) {
        const input = document.createElement('textarea'); input.dataset.repository = repo.id; input.placeholder = tGuard('message'); input.setAttribute('aria-label', `${repo.name}: ${tGuard('message')}`); input.value = this.ui.drafts[repo.id] ?? ''; input.rows = 1;
        input.oninput = () => { this.ui.drafts[repo.id] = input.value; this.persist(); commit.disabled = !input.value.trim() || !staged.length || busy || conflicts.length > 0; };
        const busy = this.pending.has(repo.id); const conflicts = status.files.filter(file => file.index === 'U');
        const staged = status.files.filter(file => !['.', '?', 'U'].includes(file.index)); const changes = status.files.filter(file => file.worktree !== '.' && file.index !== 'U');
        const actions = document.createElement('div'); actions.className = 'guard-actions';
        const commit = this.button(tGuard('commit'), tGuard('commit'), () => this.operation(repo.id, { method: 'commit', message: this.ui.drafts[repo.id] })); commit.disabled = busy || !input.value.trim() || !staged.length || conflicts.length > 0;
        const syncMethod = status.ahead && status.behind ? 'sync' : status.behind ? 'pull' : status.ahead ? 'push' : undefined;
        const syncLabel = syncMethod === 'sync' ? `${tGuard('sync')} ↓${status.behind} ↑${status.ahead}` : syncMethod === 'pull' ? `${tGuard('pull')} ↓${status.behind}` : syncMethod === 'push' ? `${tGuard('push')} ↑${status.ahead}` : tGuard('synced');
        const sync = this.button(syncLabel, syncMethod ? tGuard(`${syncMethod}Hint`) : tGuard('synced'), () => syncMethod && this.operation(repo.id, { method: syncMethod }));
        sync.classList.add('guard-sync'); sync.dataset.method = syncMethod ?? 'none'; sync.disabled = busy || !status.upstream || !syncMethod || (syncMethod !== 'push' && conflicts.length > 0);
        const fetchTitle = status.checkedAt ? `${tGuard('fetch')} · ${tGuard('checked')}: ${new Date(status.checkedAt).toLocaleTimeString()}` : `${tGuard('fetch')} · ${tGuard('previous')}`;
        const fetch = this.button('', fetchTitle, () => this.operation(repo.id, { method: 'fetch' })); fetch.className = 'guard-icon-button guard-fetch'; fetch.innerHTML = ICONS.fetch; fetch.disabled = busy || !status.upstream;
        commit.classList.add('is-primary'); actions.append(commit, sync, fetch); section.append(input, actions);
        const group = (label: string, files: GuardFile[], source: 'working' | 'staged', conflict = false) => {
          if (!files.length) return;
          const header = document.createElement('div'); header.className = 'guard-group'; header.textContent = `${label} (${files.length})`;
          if (!conflict) header.append(this.button(source === 'staged' ? '−' : '+', `${tGuard('all')} ${source === 'staged' ? tGuard('unstage') : tGuard('stage')}`, () => this.operation(repo.id, { method: source === 'staged' ? 'unstage' : 'stage', paths: files.flatMap(file => file.oldPath ? [file.oldPath, file.path] : [file.path]) })));
          section.append(header); this.fileTree(section, repo.id, files, source, busy, conflict);
        };
        group(tGuard('conflicts'), conflicts, 'working', true); group(tGuard('staged'), staged, 'staged'); group(tGuard('changes'), changes, 'working');
      }
      this.body.append(section);
    }
    this.renderHistory();
    if (selection) { const next = [...this.body.querySelectorAll('textarea')].find(input => input.dataset.repository === selection.id); next?.focus(); next?.setSelectionRange(selection.start, selection.end); }
  }
  private fileTree(root: HTMLElement, id: string, files: GuardFile[], source: 'working' | 'staged' | 'commit', busy = false, conflict = false): void {
    type Node = { dirs: Map<string, Node>; files: GuardFile[] };
    const tree: Node = { dirs: new Map(), files: [] };
    for (const file of files) { let node = tree; for (const part of file.path.split('/').slice(0, -1)) { let next = node.dirs.get(part); if (!next) { next = { dirs: new Map(), files: [] }; node.dirs.set(part, next); } node = next; } node.files.push(file); }
    const walk = (node: Node, depth: number, prefix: string): void => {
      for (const [name, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
        // Collapse single-child directory chains like VS Code's compact folders.
        let label = name; let target = child; let path = `${prefix}${name}/`;
        while (!target.files.length && target.dirs.size === 1) { const [[next, nested]] = [...target.dirs]; label += `/${next}`; path += `${next}/`; target = nested; }
        const key = `${id}:${source}:${path}`; const collapsed = this.collapsedDirs.has(key);
        const row = document.createElement('div'); row.className = 'guard-file guard-dir'; row.style.paddingLeft = `${8 + depth * 12}px`; row.tabIndex = 0; row.title = path; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-expanded', String(!collapsed));
        row.innerHTML = `<span class="guard-twisty">${collapsed ? ICONS.chevronRight : ICONS.chevronDown}</span><span class="guard-file-icon">${ICONS.folder}</span>`;
        const text = document.createElement('span'); text.className = 'guard-file-name'; text.textContent = label; row.append(text);
        const toggle = (): void => { if (collapsed) this.collapsedDirs.delete(key); else this.collapsedDirs.add(key); this.render(); };
        row.onclick = toggle; row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
        root.append(row); if (!collapsed) walk(target, depth + 1, path);
      }
      for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) { const row = this.fileRow(id, file, source, busy, conflict, true); row.style.paddingLeft = `${8 + depth * 12 + 16}px`; root.append(row); }
    };
    walk(tree, 0, '');
  }
  private fileRow(id: string, file: GuardFile, source: 'working' | 'staged' | 'commit', busy = false, conflict = false, nested = false): HTMLElement {
    const row = document.createElement('div'); row.className = 'guard-file'; row.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path; row.dataset.path = file.path;
    const name = file.path.split('/').pop()!; const folder = file.path.slice(0, -name.length);
    const openDiff = this.button(name, row.title, () => this.options.client.request({ method: 'openDiff', repository: id, paths: [file.path], source, revision: this.selectedCommit?.hash })); openDiff.className = 'guard-file-name'; openDiff.disabled = file.submodule || conflict;
    const parent = document.createElement('span'); parent.className = 'guard-file-path'; parent.textContent = nested ? '' : folder;
    const letter = file.submodule ? 'S' : source === 'working' ? file.worktree : file.index;
    const state = document.createElement('span'); state.className = `guard-file-status is-${statusClass(letter)}`; state.textContent = letter;
    if (letter === 'D') row.classList.add('is-deleted');
    const icon = document.createElement('span'); icon.className = 'guard-file-icon'; icon.innerHTML = file.submodule ? ICONS.folder : fileIcon(name);
    const actions = document.createElement('span'); actions.className = 'guard-file-actions';
    const action = (svg: string, title: string, run: () => void | Promise<unknown>): void => { const button = this.button('', title, run); button.className = 'guard-icon-button'; button.innerHTML = svg; actions.append(button); };
    if (!file.submodule && (source === 'commit' || file.worktree !== 'D')) action(ICONS.open, tGuard('open'), () => this.options.client.request({ method: 'openFile', repository: id, paths: [file.path] }));
    if (source !== 'commit') {
      if (source === 'working' && !file.submodule && !conflict) action(ICONS.discard, tGuard('discard'), () => this.operation(id, { method: 'discard', paths: [file.path] }));
      action(source === 'staged' ? ICONS.minus : ICONS.plus, source === 'staged' ? tGuard('unstage') : tGuard('stage'), () => this.operation(id, { method: source === 'staged' ? 'unstage' : 'stage', paths: file.oldPath ? [file.oldPath, file.path] : [file.path] }));
    }
    row.append(icon, openDiff, parent, actions, state);
    row.querySelectorAll('button').forEach(button => { if (busy) button.disabled = true; }); return row;
  }
  private async loadHistory(cursor?: string): Promise<void> {
    const id = this.ui.selected; if (!id || this.histories.has(id) && !cursor) return;
    const generation = this.generation;
    try { const page = await this.options.client.request({ method: 'history', repository: id, cursor }) as GuardHistory; if (generation !== this.generation || this.disposed) return; this.histories.set(id, { ...page, entries: cursor ? [...(this.histories.get(id)?.entries ?? []), ...page.entries] : page.entries }); this.renderHistory(); }
    catch (error) { this.error(error); }
  }
  /**
   * Rebuilds the history footer only when what it shows changes. render() runs on every status
   * poll and file-watcher event; rebuilding here unconditionally used to wipe the commit file
   * list and re-request it each time, which made the history view flicker.
   */
  private applyHistoryCollapsed(): void {
    this.footer.classList.toggle('is-collapsed', this.historyCollapsed); this.resizeHandle.hidden = this.historyCollapsed;
    this.footer.style.height = this.historyCollapsed ? '' : `${this.ui.historyHeight ?? 240}px`;
  }
  private renderHistory(): void {
    const id = this.ui.selected; const history = id ? this.histories.get(id) : undefined;
    const key = id ? `${id}|${this.selectedCommit?.hash ?? ''}|${history?.entries.length ?? -1}|${history?.cursor ?? ''}|${this.selectedCommit && this.commitFiles.has(this.selectedCommit.hash) ? 'files' : ''}|${this.repositories.find(repo => repo.id === id)?.name ?? ''}|${this.historyCollapsed}` : '';
    if (key === this.historyKey) return; this.historyKey = key;
    this.footer.replaceChildren(); if (!id) return;
    const head = document.createElement('div'); head.className = 'guard-history-head'; head.tabIndex = 0; head.setAttribute('role', 'button'); head.setAttribute('aria-expanded', String(!this.historyCollapsed));
    head.title = this.historyCollapsed ? tGuard('expandHistory') : tGuard('collapseHistory');
    const toggleHistory = (): void => { this.historyCollapsed = !this.historyCollapsed; this.applyHistoryCollapsed(); this.renderHistory(); };
    head.onclick = toggleHistory; head.onkeydown = event => { if (event.target === head && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleHistory(); } };
    const twisty = document.createElement('span'); twisty.className = 'guard-twisty'; twisty.innerHTML = this.historyCollapsed ? ICONS.chevronRight : ICONS.chevronDown; head.append(twisty);
    const title = document.createElement('strong'); title.textContent = `${tGuard('history')} · ${this.repositories.find(repo => repo.id === id)?.name ?? ''}`; head.append(title); this.footer.append(head);
    if (this.historyCollapsed) return;
    if (this.selectedCommit) {
      const commit = this.selectedCommit;
      const back = this.button('', tGuard('back'), () => { this.selectedCommit = undefined; this.renderHistory(); }); back.className = 'guard-back'; back.innerHTML = ICONS.back; back.append(tGuard('back')); head.append(back);
      const description = document.createElement('pre'); description.textContent = `${commit.message}\n\n${commit.author} · ${new Date(commit.timestamp).toLocaleString()}\n${commit.hash}${commit.parents.length > 1 ? `\n${tGuard('first')}` : ''}`; this.footer.append(description);
      const filesRoot = document.createElement('div'); this.footer.append(filesRoot);
      const cached = this.commitFiles.get(commit.hash);
      if (cached) { cached.forEach(file => filesRoot.append(this.fileRow(id, file, 'commit'))); return; }
      void this.options.client.request({ method: 'commitFiles', repository: id, revision: commit.hash }).then(files => { this.commitFiles.set(commit.hash, files as GuardFile[]); if (this.ui.selected !== id || this.selectedCommit !== commit) return; this.renderHistory(); }).catch(error => this.error(error)); return;
    }
    for (const commit of this.histories.get(id)?.entries ?? []) {
      const item = this.button(commit.message.split('\n')[0], `${commit.author} · ${new Date(commit.timestamp).toLocaleString()} · ${commit.hash.slice(0, 8)}`, () => { this.selectedCommit = commit; this.renderHistory(); }); item.className = 'guard-commit';
      const author = document.createElement('small'); author.textContent = ` ${commit.author} · ${new Date(commit.timestamp).toLocaleDateString()}`; item.append(author); this.footer.append(item);
    }
    const cursor = this.histories.get(id)?.cursor; if (cursor) this.footer.append(this.button(tGuard('more'), tGuard('more'), () => this.loadHistory(cursor)));
  }
  dispose(): void { this.disposed = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.subscription.dispose(); this.discoverySubscription?.dispose(); window.removeEventListener('focus', this.onFocus); window.removeEventListener('blur', this.onBlur); void this.options.client.request({ method: 'active', active: false }).catch(() => undefined); this.element.remove(); }
}
function installStyles(): void {
  if (document.getElementById('version-guard-styles')) return;
  const style = document.createElement('style'); style.id = 'version-guard-styles'; style.textContent = `
.version-guard{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--vscode-foreground,#ccc);background:var(--vscode-sideBar-background,var(--vscode-editorWidget-background,#202020));font:inherit;line-height:1.5;overflow:hidden}
.version-guard header{display:flex;align-items:center;gap:6px;padding:8px;min-height:24px;border-bottom:1px solid var(--vscode-panel-border,#444)}.version-guard header strong{flex:1}.version-guard button{font:inherit;color:inherit;background:transparent;border:0;border-radius:3px;cursor:pointer;padding:3px 5px}.version-guard button:hover{background:var(--vscode-list-hoverBackground,#ffffff15)}.version-guard button:disabled{opacity:.45;cursor:default}.version-guard button:focus-visible,.version-guard textarea:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff)}
.guard-grip{cursor:grab}.guard-notice{padding:0 8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}.guard-notice:not(:empty){padding:8px}.guard-notice.is-error{color:var(--vscode-errorForeground,#f88)}.guard-repositories{flex:1;min-height:80px;overflow:auto;padding-bottom:6px}.guard-repo-title{position:relative;display:flex;align-items:center;padding:4px 6px;gap:4px;min-height:22px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border,color-mix(in srgb,currentColor 14%,transparent))}.guard-repo-title:hover{background:var(--vscode-list-hoverBackground,color-mix(in srgb,currentColor 8%,transparent))}.guard-repo-title:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:-1px}.guard-repo-title.is-loading::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,transparent 0,var(--vscode-progressBar-background,#0e70c0) 40%,var(--vscode-progressBar-background,#0e70c0) 60%,transparent 100%) no-repeat;background-size:35% 100%;animation:guard-progress 1.1s linear infinite}@keyframes guard-progress{from{background-position:-50% 0}to{background-position:150% 0}}@media (prefers-reduced-motion:reduce){.guard-repo-title.is-loading::after{animation:none;background:var(--vscode-progressBar-background,#0e70c0);opacity:.6}}.guard-repo-title.is-selected{background:var(--vscode-list-inactiveSelectionBackground,#ffffff10)}.guard-repo-name{font-weight:600!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guard-branch{margin-left:auto;opacity:.75;white-space:nowrap}.guard-repository textarea{box-sizing:border-box;width:calc(100% - 16px);margin:5px 8px;padding:6px;resize:vertical;font:inherit;line-height:1.4;min-height:calc(1.4em + 14px);color:inherit;background:var(--vscode-input-background,#333);border:1px solid var(--vscode-input-border,#555);border-radius:4px}.guard-actions{display:flex;gap:4px;padding:0 8px}.version-guard .guard-actions button{border:1px solid var(--vscode-button-border,color-mix(in srgb,currentColor 25%,transparent));background:var(--vscode-button-secondaryBackground,color-mix(in srgb,currentColor 10%,transparent));color:var(--vscode-button-secondaryForeground,inherit)}.version-guard .guard-actions button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,color-mix(in srgb,currentColor 18%,transparent))}.version-guard .guard-actions button.is-primary{flex:1;background:var(--vscode-button-background,#225d89);color:var(--vscode-button-foreground,#fff)}.version-guard .guard-actions button.is-primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground,#1c4f75)}.version-guard .guard-actions button:disabled{opacity:.45}.version-guard .guard-actions .guard-sync{white-space:nowrap}.version-guard .guard-actions .guard-fetch{flex:none;width:auto;height:auto;padding:0 6px;opacity:1}.guard-checked{display:block;opacity:.6;padding:5px 8px}.guard-group{display:flex;align-items:center;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:4px 8px;margin-top:6px;background:var(--vscode-sideBarSectionHeader-background,color-mix(in srgb,currentColor 9%,transparent));border-top:1px solid var(--vscode-sideBarSectionHeader-border,color-mix(in srgb,currentColor 14%,transparent));border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,color-mix(in srgb,currentColor 14%,transparent))}.guard-group button{margin-left:auto}.guard-file{display:flex;align-items:center;gap:3px;padding:1px 6px;min-height:24px}.guard-file:hover,.guard-file:focus-within{background:var(--vscode-list-hoverBackground,color-mix(in srgb,currentColor 8%,transparent))}.guard-dir{cursor:pointer;gap:2px}.guard-dir:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:-1px}.guard-twisty,.guard-file-icon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;opacity:.9}.guard-twisty{opacity:.7}.guard-file-actions{display:none;flex:none;gap:1px}.guard-file:hover .guard-file-actions,.guard-file:focus-within .guard-file-actions{display:inline-flex}.version-guard .guard-icon-button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border-radius:4px;opacity:.8}.version-guard .guard-icon-button:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground,color-mix(in srgb,currentColor 14%,transparent))}.guard-file.is-deleted .guard-file-name{text-decoration:line-through;opacity:.6}.guard-file .guard-file-status.is-deleted{color:var(--vscode-gitDecoration-deletedResourceForeground,#c74e39)}.guard-file .guard-file-status.is-added{color:var(--vscode-gitDecoration-addedResourceForeground,#3fa266)}.guard-file .guard-file-status.is-untracked{color:var(--vscode-gitDecoration-untrackedResourceForeground,#3fa266)}.guard-file .guard-file-status.is-renamed{color:var(--vscode-gitDecoration-renamedResourceForeground,#3fa266)}.guard-file-status{width:14px;text-align:center;flex:none}.guard-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;flex-shrink:1;min-width:40px}.guard-file-path{opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}.guard-file-status{color:var(--vscode-gitDecoration-modifiedResourceForeground,#c99)}.guard-history-resize{height:5px;flex:none;cursor:row-resize;border-top:1px solid var(--vscode-panel-border,#444)}.guard-history{flex:none;min-height:100px;max-height:60%;overflow:auto;padding:6px;box-sizing:border-box}.guard-history-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;border-radius:3px}.guard-history-head:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff)}.guard-history.is-collapsed{height:auto!important;min-height:0;flex:none}.guard-history.is-collapsed .guard-history-head{margin-bottom:0}.guard-history-resize[hidden]{display:none}.guard-repository.is-nested{margin-left:calc(var(--guard-depth,1) * 12px);border-left:1px solid var(--vscode-tree-indentGuidesStroke,color-mix(in srgb,currentColor 18%,transparent))}.guard-history-head strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.version-guard .guard-back{display:inline-flex;align-items:center;gap:4px;flex:none;padding:2px 8px 2px 6px;border:1px solid var(--vscode-button-border,color-mix(in srgb,currentColor 25%,transparent));background:var(--vscode-button-secondaryBackground,color-mix(in srgb,currentColor 10%,transparent));color:var(--vscode-button-secondaryForeground,inherit)}.version-guard .guard-back:hover{background:var(--vscode-button-secondaryHoverBackground,color-mix(in srgb,currentColor 18%,transparent))}.guard-history pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}.guard-commit{display:block;width:100%;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guard-commit:before{content:'●';color:var(--vscode-focusBorder,#3794ff);margin-right:8px}.guard-commit small{opacity:.5}
`; document.head.append(style);
}
const svg = (body: string, extra = ''): string => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${extra}>${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  chevronDown: svg('<path d="M4 6l4 4 4-4"/>', stroke), chevronRight: svg('<path d="M6 4l4 4-4 4"/>', stroke),
  folder: svg('<path d="M1.5 4.5v8h13v-7H7.5L6 4H1.5z" fill="#dcb67a" stroke="#c09553" stroke-width=".8"/>'),
  file: svg('<path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5V5h3.5" fill="none" stroke="#9aa3ad" stroke-width="1"/>'),
  json: svg('<text x="8" y="12" text-anchor="middle" font-size="10" font-weight="700" font-family="monospace" fill="#cbcb41">{}</text>'),
  markdown: svg('<rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="#519aba" stroke-width="1.1"/><path d="M3.5 10.5v-5l2 2.2 2-2.2v5M11 5.5v4.5M9.5 8.7l1.5 1.5 1.5-1.5" fill="none" stroke="#519aba" stroke-width="1.1"/>'),
  image: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="#a074c4" stroke-width="1.1"/><circle cx="5.5" cy="6" r="1.2" fill="#a074c4"/><path d="M2 12l4-4 3 3 2-2 3.5 3.5" fill="none" stroke="#a074c4" stroke-width="1.1"/>'),
  excalidraw: svg('<path d="M3 13l3.5-1 7-7-2.5-2.5-7 7z" fill="none" stroke="#6965db" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 4l2.5 2.5" stroke="#6965db" stroke-width="1.2"/>'),
  code: svg('<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="#519aba" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
  open: svg('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4"/>', stroke),
  discard: svg('<path d="M3.5 6.5h6.5a3 3 0 010 6H7M6 3.5l-3 3 3 3"/>', stroke),
  back: svg('<path d="M13 8H3M7 4L3 8l4 4"/>', stroke),
  plus: svg('<path d="M8 3v10M3 8h10"/>', stroke), minus: svg('<path d="M3 8h10"/>', stroke),
  fetch: svg('<path d="M4.5 12.5a3 3 0 01-.3-6 4 4 0 017.6-.8 3.2 3.2 0 01.4 6.8"/><path d="M8 8v5.5M6.2 11.8L8 13.5l1.8-1.7"/>', stroke),
};
function fileIcon(name: string): string {
  const lower = name.toLowerCase(); const ext = lower.split('.').pop() ?? '';
  if (lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.json') || lower.endsWith('.excalidraw.md')) return ICONS.excalidraw;
  if (ext === 'json' || ext === 'jsonc') return ICONS.json;
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return ICONS.markdown;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) return ICONS.image;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'html', 'py', 'java', 'go', 'rs', 'sh', 'vue', 'yml', 'yaml', 'xml'].includes(ext)) return ICONS.code;
  return ICONS.file;
}
function statusClass(letter: string): string { return letter === 'D' ? 'deleted' : letter === 'A' ? 'added' : letter === '?' || letter === 'U' ? 'untracked' : letter === 'R' ? 'renamed' : 'modified'; }
