import './bootLocale';
import { TimelinePanel, RpcTimelineClient, showHistorySettingsDialog } from '@easyview/editor-core/timeline';
import type { TimelineUiState } from '@easyview/contracts';
import type { HostToEditorMessage, EditorToHostMessage } from '@easyview/contracts';
import { readLocalProductTheme } from '@easyview/contracts';
import { applyDesktopProductAppearance } from './productThemeControl';
import { createEasyViewEditor, EditorAppearanceStore, type EasyViewEditorInstance } from '@easyview/editor-core';
import { isDesktopAppearanceCommand } from '../contracts';
import type { DesktopAppearanceMode, DesktopEditorTab, DesktopTab, DesktopTabSnapshot, DesktopThemeMode } from '../contracts';
import type { EasyViewDesktopApi } from '../preload/desktopApi';
import type { EasyViewAccentTheme } from '@easyview/editor-core';
import { createDesktopEditorHostTransport } from './desktopHostTransport';
import { DesktopEditorInstanceRegistry } from './DesktopEditorInstanceRegistry';
import { WorkspaceExplorer } from './workspace/WorkspaceExplorer';
import { ActiveViewController } from './ActiveViewController';
import { TabController } from './TabController';
import { WelcomePage } from './WelcomePage';
import { tDesktop } from './desktopRenderer.i18n';

interface WindowWithDesktopApi extends Window {
  easyViewDesktop: EasyViewDesktopApi;
  systemLocale?: string;
  csvDelimiterSetting?: string;
  __easyviewPdfFonts?: {
    normal: string;
    bold: string;
    symbols: string;
  };
}

declare const window: WindowWithDesktopApi;

const api = window.easyViewDesktop;
if (!api?.editor || !api.app || !api.document) {
  document.body.innerHTML = '<main style="padding:24px;font-family:system-ui">EasyView_Md 宿主接口加载失败。Failed to load the EasyView_Md host API.</main>'; // i18n-ignore
  throw new Error('EasyView_Md preload API is unavailable');
}

const sharedEditorHost = createDesktopEditorHostTransport({
  postMessage: (message: EditorToHostMessage) => api.editor.postMessage(message),
  subscribe: (listener: (message: HostToEditorMessage) => void) =>
    api.editor.subscribe(listener),
});

const productAppearance = new EditorAppearanceStore(
  window.localStorage,
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
applyDesktopProductAppearance(productAppearance.state, document);

function applyOsTheme(theme: DesktopThemeMode): void {
  productAppearance.setMode(readLocalProductTheme(window.localStorage, theme === 'dark' ? 'dark' : 'light'), false);
}

window.systemLocale = navigator.language || 'en-US';
window.csvDelimiterSetting = 'auto';
window.__easyviewPdfFonts = {
  normal: new URL('./fonts/SourceHanSansCN-Normal.otf', window.location.href).toString(),
  bold: new URL('./fonts/SourceHanSansCN-Heavy.otf', window.location.href).toString(),
  symbols: new URL('./fonts/NotoSansSymbols2-Regular.ttf', window.location.href).toString(),
};

function localizeShell(): void {
  const aiChatToggleButton = document.getElementById('ai-chat-toggle');
  aiChatToggleButton?.setAttribute('title', tDesktop('shell.aiChatToggle'));
  aiChatToggleButton?.setAttribute('aria-label', tDesktop('shell.aiChat'));
  document.getElementById('desktop-tab-bar')?.setAttribute('aria-label', tDesktop('shell.openTabs'));
  document.getElementById('desktop-welcome')?.setAttribute('aria-label', tDesktop('shell.welcome'));
  document.getElementById('desktop-ai-chat-host')?.setAttribute('aria-label', tDesktop('shell.aiChat'));
}
localizeShell();

const titleName = document.getElementById('desktop-document-name')!;
// Page zoom changes the CSS viewport, which fires resize; the title bar cancels it out (see desktop.css).
const syncTitleBarZoom = (): void => {
  document.documentElement.style.setProperty('--desktop-page-zoom', String(api.app.getZoomFactor()));
};
window.addEventListener('resize', syncTitleBarZoom);
syncTitleBarZoom();
const explorerElement = document.getElementById('workspace-explorer')!;
const tabBar = document.getElementById('desktop-tab-bar')!;
const editorMount = document.getElementById('desktop-editor-mount')!;
const previewBody = document.getElementById('file-preview-root')!;
const splitRoot = document.getElementById('desktop-split-root')!;
let currentTab: DesktopTab | null = null;
let tabController: TabController;
let lastOutlineVisible = true;
let lastOutlineWidth = 280;
let editorStateSubscription: { unsubscribe(): void } | undefined;
const previewApi = api;
const editors = new DesktopEditorInstanceRegistry({
  mount: editorMount,
  capabilities: sharedEditorHost.capabilities,
  postMessage: (message) => sharedEditorHost.postMessage(message),
  subscribe: (listener) => sharedEditorHost.subscribe(listener),
  createEditor: ({ root, host, initialMessage }) => createEasyViewEditor({
    host,
    initialMessage,
    uiMode: 'desktop',
    appearance: productAppearance,
    outlinePosition: 'right',
    aiChatContainer: document.getElementById('desktop-ai-chat-host'),
    root,
  }),
});

function activeEditor(): EasyViewEditorInstance | null {
  return editors.active();
}

function commandEditor(): EasyViewEditorInstance | null {
  return activeEditor() ?? editors.lastFocused() ?? editors.first();
}

function bindActiveEditor(editor: EasyViewEditorInstance | null): void {
  editorStateSubscription?.unsubscribe();
  // Apply the persisted outline layout before subscribing: subscribeUiState emits
  // the editor's current state immediately, and a freshly created editor starts
  // with its outline closed, which would otherwise overwrite the saved preference.
  if (editor) {
    editor.setOutlineVisible(lastOutlineVisible);
    editor.setOutlineWidth(lastOutlineWidth);
  }
  editorStateSubscription = editor?.subscribeUiState((state) => {
    workspaceExplorer.setOutlineVisible(state.outlineVisible);
    publishMenuState();
  });
}

const timelineClient = new RpcTimelineClient({
  configureSettings: () => showHistorySettingsDialog(async () => { const result = await api.timeline.getSettings(); if (!result.ok) throw new Error(result.message); return result.value; }, async (settings) => { const result = await api.timeline.setSettings(settings); if (!result.ok) throw new Error(result.message); }),
  post: (message) => api.timeline.post(message as import('@easyview/contracts').TimelineRequestMessage),
  subscribe: (listener) => api.timeline.subscribe(listener),
  loadState: () => { const raw = localStorage.getItem('easyview.timeline.state'); return raw ? JSON.parse(raw) as TimelineUiState : undefined; },
  saveState: (state) => localStorage.setItem('easyview.timeline.state', JSON.stringify(state)),
});
const timelinePanel = new TimelinePanel(timelineClient);
const welcomePage = new WelcomePage({
  api,
  container: document.getElementById('desktop-welcome')!,
  onOpenFolder: () => { void workspaceExplorer.openFolder().then((opened) => { if (opened) dismissStartupWelcome(); }); },
  onOpenRecentFolder: (folderPath) => { void workspaceExplorer.openRecentFolder(folderPath).then((opened) => { if (opened) dismissStartupWelcome(); }); },
  onResume: () => dismissStartupWelcome(),
  onShowWelcome: () => {
    welcomeRequested = true;
    if (lastTabSnapshot) syncWelcome(lastTabSnapshot);
  },
});
/** Launch shows the welcome page over restored tabs until the user picks something. */
let startupWelcome = !api.app.openedFileAtLaunch;
/** With a folder open and no tab, the pane shows a light hint unless the user asks for the full welcome page. */
let welcomeRequested = false;
let workspaceRootPath: string | null = null;

/** The full welcome page hides the restored folder until the user resumes or picks one. */
let welcomeCoversWorkspace = false;

function setWorkspaceRootPath(rootPath: string | null): void {
  if (workspaceRootPath === rootPath) return;
  workspaceRootPath = rootPath;
  welcomeRequested = false;
  if (lastTabSnapshot) syncWelcome(lastTabSnapshot);
}
let startupTabsKey: string | null = null;
let lastTabSnapshot: DesktopTabSnapshot | null = null;

function syncWelcome(snapshot: DesktopTabSnapshot): void {
  lastTabSnapshot = snapshot;
  const tabs = snapshot.groups.flatMap((group) => group.tabs);
  const tabCount = Math.max(tabs.length, snapshot.tabs.length);
  if (startupWelcome) {
    const key = `${snapshot.activeTabId}|${tabs.map((item) => item.id).join(',')}`;
    if (startupTabsKey === null) startupTabsKey = key;
    else if (key !== startupTabsKey) startupWelcome = false;
  }
  const showWelcome = tabCount === 0 || startupWelcome;
  if (tabCount > 0) welcomeRequested = false;
  const fullWelcome = (startupWelcome && tabCount > 0) || !workspaceRootPath || welcomeRequested;
  welcomePage.setMode(fullWelcome ? 'welcome' : 'empty');
  const active = snapshot.tabs.find((item) => item.id === snapshot.activeTabId) ?? tabs.find((item) => item.id === snapshot.activeTabId);
  welcomePage.setResume(startupWelcome && tabCount > 0
    ? { folderPath: workspaceRootPath, tabCount, activeFileName: active?.fileName ?? null }
    : null);
  welcomePage.setCurrentRoot(startupWelcome ? null : workspaceRootPath);
  splitRoot.hidden = showWelcome;
  welcomeCoversWorkspace = showWelcome && fullWelcome;
  document.body.classList.toggle('desktop-welcome-active', showWelcome);
  document.body.classList.toggle('desktop-welcome-full', welcomeCoversWorkspace);
  welcomePage.setVisible(showWelcome);
  renderTitle();
}

function renderTitle(): void {
  const tab = welcomeCoversWorkspace ? null : currentTab;
  titleName.textContent = tab ? tab.fileName : 'EasyView_Md';
  if (tab?.kind === 'editor') titleName.dataset.filePath = tab.filePath;
  else titleName.removeAttribute('data-file-path');
}

function dismissStartupWelcome(): void {
  if (!startupWelcome) return;
  startupWelcome = false;
  if (lastTabSnapshot) syncWelcome(lastTabSnapshot);
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !welcomePage.isVisible()) return;
  if (welcomeRequested) {
    event.preventDefault();
    welcomeRequested = false;
    if (lastTabSnapshot) syncWelcome(lastTabSnapshot);
    return;
  }
  if (!startupWelcome) return;
  event.preventDefault();
  dismissStartupWelcome();
});
const workspaceExplorer = new WorkspaceExplorer({
  footer: timelinePanel.element,
  onSelectionChanged: (filePath, visible) => { timelinePanel.setVisible(visible); timelinePanel.setFile(filePath); },
  api,
  container: explorerElement,
  onStateChange: (state) => {
    setWorkspaceRootPath(state.rootPath);
    lastOutlineVisible = state.outlineVisible;
    lastOutlineWidth = state.outlineWidth;
    activeEditor()?.setOutlineVisible(state.outlineVisible);
    document.getElementById('workspace-toggle')?.classList.toggle('active', state.explorerVisible);
    publishMenuState();
  },
  onOpenFile: async (relativePath) => {
    const opened = await tabController.openWorkspaceEntry(relativePath);
    if (opened) dismissStartupWelcome();
    return opened;
  },
  onOpenWithDefaultApp: (relativePath) => { void previewApi.system.openWithDefaultApp(relativePath); },
  onRevealInFolder: (relativePath) => { void previewApi.system.revealInFolder(relativePath); },
});

const activeView = new ActiveViewController({
  api, splitRoot, editorBody: editorMount, previewBody, tabBar,
  onViewChanged: () => publishMenuState(),
});

function visibleEditorTabs(snapshot: { groups: Array<{ tabs: DesktopTab[]; activeTabId: string | null }> }): DesktopEditorTab[] {
  const visible: DesktopEditorTab[] = [];
  for (const group of snapshot.groups) {
    const tab = group.tabs.find((item) => item.id === group.activeTabId);
    if (tab?.kind === 'editor') visible.push(tab);
  }
  return visible;
}

function bindVisibleEditors(snapshot: { groups: Array<{ id: string; tabs: DesktopTab[]; activeTabId: string | null }> }, focused: DesktopTab | null): void {
  const visible = visibleEditorTabs(snapshot);
  const groupMounts = activeView.editorMounts();
  const mounts = new Map<string, HTMLElement>();
  for (const group of snapshot.groups) {
    const mount = groupMounts.get(group.id);
    const tab = group.tabs.find((item) => item.id === group.activeTabId);
    if (mount && tab?.kind === 'editor') mounts.set(tab.id, mount);
  }
  editors.setVisible(visible, mounts);
  if (focused?.kind === 'editor') {
    editors.focus(focused.id);
    bindActiveEditor(editors.active());
  } else {
    editors.clearActive();
    bindActiveEditor(null);
  }
  editors.syncOpenTabs(snapshot.groups.flatMap((group) => group.tabs).filter((item) => item.kind === 'editor').map((item) => item.id));
}

tabController = new TabController({
  api,
  onActiveTabChanged: (tab, snapshot) => {
    currentTab = tab;
    syncWelcome(snapshot);
    document.body.classList.toggle('desktop-history-only', tab?.kind === 'history' && visibleEditorTabs(snapshot).length === 0);
    void activeView.showSnapshot(snapshot);
    bindVisibleEditors(snapshot, tab);
    if (!tab) workspaceExplorer.setActiveRelativePath(null);
    else if (tab.kind === 'editor') workspaceExplorer.setActiveDocument(tab.filePath);
    else if (tab.kind !== 'history') workspaceExplorer.setActiveRelativePath(tab.relativePath);
    publishMenuState();
  },
});

function publishMenuState(): void {
  const state = activeEditor()?.getUiState() ?? {
    sourceMode: false,
    outlineVisible: lastOutlineVisible,
    fullWidth: true,
    tableWrap: false,
    viewChanges: false,
  };
  const appearance = productAppearance.state;
  api.menu.publishState({
    ...state,
    hasActiveDocument: currentTab?.kind === 'editor',
    themeMode: appearance.mode,
    themeDepth: Math.round(appearance.depth * 100),
    accent: appearance.accent,
  });
}

document.getElementById('workspace-toggle')?.addEventListener('click', () => workspaceExplorer.toggle());
const aiChatToggle = document.getElementById('ai-chat-toggle');
aiChatToggle?.addEventListener('click', () => commandEditor()?.executeCommand('toggleAiChat'));
window.addEventListener('easyview-ai-chat-visibility-change', (event) => {
  aiChatToggle?.classList.toggle('active', (event as CustomEvent<boolean>).detail);
});
api.document.onChanged((documentState) => {
  if (currentTab?.kind !== 'editor') return;
  if (!welcomeCoversWorkspace) {
    titleName.textContent = documentState.fileName;
    titleName.dataset.filePath = documentState.filePath;
  }
  workspaceExplorer.setActiveDocument(documentState.filePath);
  publishMenuState();
});

window.addEventListener('easyview-toc-width-change', (event) => {
  const width = (event as CustomEvent<number>).detail;
  if (!Number.isFinite(width)) return;
  void api.workspace.getState().then((result) => {
    if (result.ok) void api.workspace.setState({ ...result.value, outlineWidth: width });
  });
});

api.menu.onRevealInIndexArea((relativePath) => {
  void workspaceExplorer.revealRelativePath(relativePath);
});

api.menu.onCommand((command) => {
  if (command === 'toggleTheme') {
    productAppearance.cycleMode();
    return;
  }
  if (isDesktopAppearanceCommand(command)) {
    const [kind, value] = command.split(':');
    if (kind === 'setThemeMode') productAppearance.setMode(value as DesktopAppearanceMode);
    else if (kind === 'setThemeDepth') productAppearance.setDepth(Number(value) / 100);
    else productAppearance.setAccent(value as EasyViewAccentTheme);
    return;
  }
  if (command === 'toggleExplorer') {
    workspaceExplorer.toggle();
    return;
  }
  if (command === 'rename') {
    const currentName = titleName.textContent ?? '';
    const nextName = window.prompt(tDesktop('rename.prompt'), currentName);
    if (nextName?.trim() && currentTab?.kind === 'editor') {
      void api.document.rename(nextName.trim(), currentTab.id);
    }
    return;
  }
  activeEditor()?.executeCommand(command);
});

const appearanceSubscription = productAppearance.subscribe((state) => {
  applyDesktopProductAppearance(state, document);
  publishMenuState();
});

void workspaceExplorer.initialize().then(async (state) => {
  setWorkspaceRootPath(state.rootPath);
  lastOutlineVisible = state.outlineVisible;
  lastOutlineWidth = state.outlineWidth;
  document.getElementById('workspace-toggle')?.classList.toggle('active', state.explorerVisible);
  activeEditor()?.setOutlineVisible(state.outlineVisible);
  activeEditor()?.setOutlineWidth(state.outlineWidth);
  await tabController.initialize();
  publishMenuState();
});

const themeSubscription = api.app.onThemeChanged(applyOsTheme);
void api.app.getTheme().then((result) => {
  if (result.ok) applyOsTheme(result.value);
});

window.addEventListener('unload', () => {
  themeSubscription.unsubscribe();
  appearanceSubscription.unsubscribe();
  editorStateSubscription?.unsubscribe();
  tabController.dispose();
  workspaceExplorer.dispose();
  activeView.dispose();
  editors.dispose();
}, { once: true });

window.addEventListener('pagehide', () => { timelinePanel.dispose(); timelineClient.dispose(); });
