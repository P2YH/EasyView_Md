import { migrateRenamedHistory } from '@easyview/node-runtime';
import { DESKTOP_TAB_CLOSE_SHORTCUT } from '../../../contracts';
import { captureDesktopHistoryPath, desktopHistory } from '../document/desktopHistory';
import { isTimelineMarkdown } from '@easyview/contracts';
import { Menu, clipboard, dialog, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWorkspaceRelativePath } from '@easyview/node-runtime';
import type { OperationResult } from '@easyview/contracts';
import type {
  DesktopTab,
  DesktopTabContextCommand,
  DesktopTabSnapshot,
  DesktopWorkspaceState,
  WorkspaceContextCommand,
  WorkspaceDeleteRequest,
  WorkspaceEntry,
  WorkspaceImportExternalRequest,
  WorkspacePasteRequest,
  WorkspaceRenameRequest,
} from '../../../contracts';
import { desktopWorkspaceErrorMessage } from './DesktopWorkspaceCore';
import { openWithSystemApplicationPicker } from './openWithSystemApplicationPicker';
import { WorkspaceWatcher } from './WorkspaceWatcher';
import { recentFolderStore } from './recentFolders';
import { tWorkspace } from './workspace.i18n';
import { resolvePreviewRoute } from '../../../contracts';
import {
  documentSessions,
  failure,
  filePathKey,
  isMarkdownPath,
  getMainWindow,
  getWorkspaceFileClipboard,
  getWorkspaceWatcher,
  hostHooks,
  getWindowContext,
  notifyActiveDocument,
  previewFailure,
  previewSessions,
  rendererWindow,
  sendToWindow,
  setWorkspaceFileClipboard,
  setWorkspaceState,
  showMessageBoxFor,
  success,
  syncTabState,
  tabRegistry,
  tabSnapshot,
  workspaceCore,
  workspaceRoot,
  setWorkspaceWatcher,
  runInWindowContext,
} from '../host/desktopRuntime';
import {
  closeAllTabResources,
  closeGroupTabs,
  closeOtherTabs,
  closeTab,
  closeTabIds,
  confirmCloseAll,
  openWorkspaceEntryTab,
  registerPreviewTab,
  resolveWorkspaceFilePath,
  stopWatcher,
  watchDocumentSession,
} from '../document/documentWorkflow';

export function stopWorkspaceWatcher(): void {
  getWorkspaceWatcher()?.stop();
  setWorkspaceWatcher(undefined);
}

export function startWorkspaceWatcher(rootPath: string): void {
  stopWorkspaceWatcher();
  const context = getWindowContext();
  const watcher = new WorkspaceWatcher(rootPath, {
    onChange(relativePaths) {
      runInWindowContext(context, () => {
        const affected = workspaceCore.invalidateFromWatcher(relativePaths);
        sendToWindow('workspace.changed', affected);
        void previewSessions.staleRelativePaths(relativePaths).then((stale) => {
          if (stale.length) runInWindowContext(context, () => sendToWindow('preview.fileChanged', stale));
        }).catch((error) => console.warn('[Preview]', error));
        for (const relativePath of relativePaths ?? []) if (isTimelineMarkdown(relativePath)) void captureDesktopHistoryPath(path.join(rootPath, relativePath)).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[Timeline]', error); });
      });
    },
  });
  setWorkspaceWatcher(watcher);
  try {
    watcher.start();
  } catch (error) {
    console.warn('[EasyView_Md] Workspace watcher unavailable:', error);
    stopWorkspaceWatcher();
  }
}

export async function openWorkspaceFolder(folderPath?: string): Promise<OperationResult<DesktopWorkspaceState | null>> {
  let requestedPath = folderPath;
  if (!requestedPath) {
    const selected = await dialog.showOpenDialog(getMainWindow()!, {
      properties: ['openDirectory'],
      title: tWorkspace('open.title'),
    });
    if (selected.canceled || !selected.filePaths[0]) return success(null);
    requestedPath = selected.filePaths[0];
  }
  let candidateRoot: string;
  try {
    candidateRoot = await fs.realpath(requestedPath);
    const candidateStat = await fs.stat(candidateRoot);
    if (!candidateStat.isDirectory()) return failure('INVALID_ARGUMENT', tWorkspace('open.notDirectory'));
  } catch (error) {
    if (folderPath && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      await recentFolderStore().forget(folderPath);
      hostHooks.createMenu();
      return failure('NOT_FOUND', tWorkspace('open.folderMissing', { folderPath }));
    }
    return failure('INVALID_ARGUMENT', desktopWorkspaceErrorMessage(error));
  }
  try {
    if (workspaceRoot() !== candidateRoot) {
      if (!(await confirmCloseAll())) return success(null);
      await closeAllTabResources();
      setWorkspaceFileClipboard(null);
    }
    const rootPath = await workspaceCore.bindRoot(candidateRoot);
    const next = setWorkspaceState({ rootPath, openTabs: [], activeTabId: null, expandedRelativePaths: [], explorerIconDirectory: '', explorerVisible: true });
    startWorkspaceWatcher(rootPath);
    syncTabState();
    if (folderPath && folderPath !== rootPath) await recentFolderStore().forget(folderPath);
    await recentFolderStore().remember(rootPath);
    hostHooks.createMenu();
    sendToWindow('workspace.rootChanged', next);
    return success(next);
  } catch (error) {
    return failure('INVALID_ARGUMENT', desktopWorkspaceErrorMessage(error));
  }
}

export function workspaceEntryAbsolutePath(relativePath: string): string {
  return workspaceCore.resolveAbsolutePath(relativePath);
}

export async function openWorkspacePreview(relativePath: string): Promise<OperationResult<DesktopTabSnapshot>> {
  try {
    const filePath = await resolveWorkspaceFilePath(relativePath);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) return failure('INVALID_ARGUMENT', tWorkspace('preview.filesOnly'));
    const snapshot = await registerPreviewTab(relativePath);
    return success(snapshot);
  } catch (error) {
    return previewFailure(error);
  }
}

export function tabResourcePaths(tab: DesktopTab): { absolutePath: string; relativePath: string } | null {
  if (tab.kind === 'editor') {
    const rootPath = workspaceRoot();
    const relativePath = rootPath ? path.relative(rootPath, tab.filePath).split(path.sep).join('/') : tab.fileName;
    return { absolutePath: tab.filePath, relativePath };
  }
  if (!workspaceRoot()) return null;
  const paths = workspaceCore.resourcePaths(tab.relativePath);
  return { absolutePath: paths.absolutePath, relativePath: paths.relativePath };
}

export async function executeTabContextCommand(tabId: string, command: DesktopTabContextCommand): Promise<OperationResult<DesktopTabSnapshot>> {
  const tab = tabRegistry.get(tabId);
  if (!tab) return failure('NOT_FOUND', tWorkspace('tabs.notFound'));
  if (command === 'close') {
    const result = await closeTab(tabId);
    return result.ok && result.value ? success(result.value) : result.ok ? failure('CANCELLED', tWorkspace('tabs.closeCancelled')) : result;
  }
  if (command === 'closeOthers') return closeOtherTabs(tabId);
  if (command === 'closeAll') return closeGroupTabs(tabId);
  if (command === 'pin' || command === 'unpin') {
    if (!tabRegistry.setPinned(tabId, command === 'pin')) return failure('INVALID_ARGUMENT', tWorkspace('tabs.notPinnable'));
    syncTabState();
    return success(tabSnapshot());
  }
  if (command === 'copyPath' || command === 'copyRelativePath') {
    const paths = tabResourcePaths(tab);
    if (!paths) return failure('INVALID_ARGUMENT', tWorkspace('tabs.noCopyablePath'));
    clipboard.writeText(command === 'copyPath' ? paths.absolutePath : paths.relativePath);
    return success(tabSnapshot());
  }
  if (command === 'revealInIndexArea') {
    const paths = tabResourcePaths(tab);
    const rootPath = workspaceRoot();
    if (!paths || !rootPath || paths.relativePath.startsWith('..') || path.isAbsolute(paths.relativePath)) {
      return failure('NOT_FOUND', tWorkspace('tabs.notInIndexArea'));
    }
    sendToWindow('workspace.revealInIndexArea', paths.relativePath);
    return success(tabSnapshot());
  }
  if (command === 'splitUp' || command === 'splitDown' || command === 'splitLeft' || command === 'splitRight') {
    const direction = command === 'splitUp' ? 'up' : command === 'splitDown' ? 'down' : command === 'splitLeft' ? 'left' : 'right';
    const group = tabRegistry.split(tabId, direction);
    if (!group) return failure('NOT_FOUND', tWorkspace('tabs.splitFailed'));
    const created = group.tabs[0];
    if (created?.kind === 'editor') {
      const source = documentSessions.get(tabId);
      if (source) documentSessions.alias(created.id, source.tabId);
    }
    syncTabState();
    if (created?.kind === 'editor') notifyActiveDocument('initial');
    return success(tabSnapshot());
  }
  return failure('DEPENDENCY_MISSING', tWorkspace('tabs.moveToNewWindowUnsupported'));
}

export async function renameWorkspaceEntry(request: WorkspaceRenameRequest): Promise<OperationResult<WorkspaceEntry>> {
  const rootPath = workspaceRoot();
  if (!rootPath) return failure('INVALID_ARGUMENT', tWorkspace('notOpen'));
  try {
    const oldPaths = workspaceCore.resourcePaths(request.relativePath);
    const nextRelativePath = path.posix.join(workspaceCore.parentRelativePath(request.relativePath), request.newName);
    const nextPaths = workspaceCore.resourcePaths(nextRelativePath);
    const affected = documentSessions.findWithinPath(oldPaths.absolutePath);
    const entry = await documentSessions.renamePath(oldPaths.absolutePath, nextPaths.absolutePath, () => workspaceCore.rename(request));
    for (const session of affected) {
      await stopWatcher(session);
      tabRegistry.renameEditor(session.tabId, session.filePath!, session.fileName);
      void watchDocumentSession(session);
    }
    tabRegistry.renamePreview(request.relativePath, entry.relativePath, entry.name);
    syncTabState();
    if (tabRegistry.active()?.kind === 'editor') notifyActiveDocument('reload');
    sendToWindow('workspace.changed', [workspaceCore.parentRelativePath(request.relativePath), workspaceCore.parentRelativePath(entry.relativePath)]);
    await migrateRenamedHistory((await desktopHistory()).local, oldPaths.absolutePath, nextPaths.absolutePath);
    return success(entry);
  } catch (error) {
    return failure('INVALID_ARGUMENT', desktopWorkspaceErrorMessage(error));
  }
}

export async function deleteWorkspaceEntry(request: WorkspaceDeleteRequest, owner = getMainWindow() ?? null): Promise<OperationResult<boolean>> {
  const rootPath = workspaceRoot();
  if (!rootPath) return failure('INVALID_ARGUMENT', tWorkspace('notOpen'));
  try {
    const paths = workspaceCore.resourcePaths(request.relativePath);
    const stat = await fs.lstat(paths.absolutePath);
    const confirmation = await showMessageBoxFor(owner, {
      type: 'warning',
      buttons: [tWorkspace('delete.moveToTrash'), tWorkspace('delete.cancel')],
      defaultId: 0,
      cancelId: 1,
      message: tWorkspace('delete.message', { name: path.basename(paths.absolutePath) }),
      detail: tWorkspace('delete.detail'),
    });
    if (confirmation.response !== 0) return failure('CANCELLED', tWorkspace('delete.cancelled'));

    const affectedTabs = tabSnapshot().groups.flatMap((group) => group.tabs).filter((tab) => {
      if (tab.kind === 'editor') {
        const key = filePathKey(tab.filePath);
        const targetKey = filePathKey(paths.absolutePath);
        return key === targetKey || (stat.isDirectory() && key.startsWith(`${targetKey}${path.sep}`));
      }
      const normalized = tab.relativePath.replace(/\\/g, '/');
      return normalized === request.relativePath || (stat.isDirectory() && normalized.startsWith(`${request.relativePath}/`));
    });
    if (!(await closeTabIds([...new Set(affectedTabs.map((tab) => tab.id))]))) return failure('CANCELLED', tWorkspace('delete.cancelled'));
    await workspaceCore.delete({ relativePath: request.relativePath, options: { useTrash: true, recursive: true } });
    sendToWindow('workspace.changed', [workspaceCore.parentRelativePath(request.relativePath)]);
    return success(true);
  } catch (error) {
    return failure('UNKNOWN', desktopWorkspaceErrorMessage(error));
  }
}

export function copyWorkspaceEntryToClipboard(relativePath: string): OperationResult<boolean> {
  const rootPath = workspaceRoot();
  if (!rootPath) return failure('INVALID_ARGUMENT', tWorkspace('notOpen'));
  try {
    const paths = workspaceCore.resourcePaths(relativePath);
    setWorkspaceFileClipboard({ relativePath: paths.relativePath });
    clipboard.writeText(paths.absolutePath);
    return success(true);
  } catch (error) {
    return failure('INVALID_ARGUMENT', desktopWorkspaceErrorMessage(error));
  }
}

async function resolvePasteTargetDirectory(targetRelativePath: string): Promise<string> {
  const rootPath = workspaceRoot();
  if (!rootPath) throw new Error(tWorkspace('notOpen'));
  const paths = workspaceCore.resourcePaths(targetRelativePath);
  const stat = await fs.lstat(paths.absolutePath);
  if (stat.isDirectory() && !stat.isSymbolicLink()) return paths.relativePath;
  return workspaceCore.parentRelativePath(paths.relativePath);
}

export async function importExternalWorkspaceEntries(
  request: WorkspaceImportExternalRequest,
  owner = getMainWindow() ?? null,
): Promise<OperationResult<WorkspaceEntry>> {
  const rootPath = workspaceRoot();
  if (!rootPath) return failure('INVALID_ARGUMENT', tWorkspace('notOpen'));
  const sourcePaths = [
    ...(Array.isArray(request.sourcePaths) ? request.sourcePaths : []),
    ...urisToFilePaths(request.sourceUris),
  ].filter((value) => typeof value === 'string' && value.trim().length > 0);
  const items = Array.isArray(request.items) ? request.items : [];
  if (sourcePaths.length === 0 && items.length === 0) return failure('INVALID_ARGUMENT', tWorkspace('import.nothingToImport'));
  try {
    const targetParentRelativePath = normalizeWorkspaceRelativePath(request.targetParentRelativePath ?? '');
    let last: WorkspaceEntry | undefined;
    if (sourcePaths.length > 0) {
      for (const sourcePath of sourcePaths) {
        last = await workspaceCore.importExternal(sourcePath, targetParentRelativePath);
      }
    } else {
      last = await workspaceCore.importExternalItems(
        targetParentRelativePath,
        items.map((item) => ({
          kind: item.kind,
          relativePath: item.relativePath,
          ...(item.dataBase64 ? { data: Buffer.from(item.dataBase64, 'base64') } : {}),
        })),
      );
    }
    if (!last) return failure('INVALID_ARGUMENT', tWorkspace('import.nothingToImport'));
    sendToWindow('workspace.changed', [targetParentRelativePath]);
    return success(last);
  } catch (error) {
    const message = desktopWorkspaceErrorMessage(error);
    void showMessageBoxFor(owner, { type: 'error', message });
    return failure('INVALID_ARGUMENT', message);
  }
}

function urisToFilePaths(uris: unknown): string[] {
  if (!Array.isArray(uris)) return [];
  const paths: string[] = [];
  for (const value of uris) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      paths.push(fileURLToPath(value));
    } catch {
      // Ignore non-file URIs from the renderer drop payload.
    }
  }
  return paths;
}

export async function pasteWorkspaceClipboard(request: WorkspacePasteRequest, owner = getMainWindow() ?? null): Promise<OperationResult<WorkspaceEntry>> {
  const rootPath = workspaceRoot();
  if (!rootPath) return failure('INVALID_ARGUMENT', tWorkspace('notOpen'));
  const clipboardState = getWorkspaceFileClipboard();
  if (!clipboardState) return failure('INVALID_ARGUMENT', tWorkspace('paste.clipboardEmpty'));
  try {
    const targetParentRelativePath = await resolvePasteTargetDirectory(request.targetRelativePath);
    const entry = await workspaceCore.copy({
      sourceRelativePath: clipboardState.relativePath,
      targetParentRelativePath,
    });
    sendToWindow('workspace.changed', [targetParentRelativePath]);
    return success(entry);
  } catch (error) {
    const message = desktopWorkspaceErrorMessage(error);
    void showMessageBoxFor(owner, { type: 'error', message });
    return failure('INVALID_ARGUMENT', message);
  }
}

export function showOpenWithPicker(relativePath: string, owner: Electron.BrowserWindow | null): void {
  const absolutePath = workspaceEntryAbsolutePath(relativePath);
  const fileName = path.basename(absolutePath);
  const markdown = isMarkdownPath(absolutePath);
  const previewRoute = resolvePreviewRoute(fileName);
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (markdown) {
    items.push({
      label: tWorkspace('openWith.editor'),
      click: () => {
        void openWorkspaceEntryTab(relativePath).then((result) => {
          if (!result.ok) void showMessageBoxFor(owner, { type: 'error', message: result.message });
        });
      },
    });
  }
  if (previewRoute || !markdown) {
    items.push({
      label: tWorkspace('openWith.preview'),
      click: () => {
        void openWorkspacePreview(relativePath).then((result) => {
          if (!result.ok) void showMessageBoxFor(owner, { type: 'error', message: result.message });
        });
      },
    });
  }
  items.push({
    label: tWorkspace('openWith.defaultApplication'),
    click: () => {
      void shell.openPath(absolutePath).then((error) => {
        if (error) void showMessageBoxFor(owner, { type: 'error', message: error });
      });
    },
  });
  items.push({ type: 'separator' });
  items.push({
    label: tWorkspace('openWith.chooseApplication'),
    click: () => {
      void openWithSystemApplicationPicker(absolutePath, owner).catch((error) => {
        void showMessageBoxFor(owner, {
          type: 'error',
          message: error instanceof Error ? error.message : tWorkspace('openWith.openFailed'),
        });
      });
    },
  });

  Menu.buildFromTemplate(items).popup({ window: owner ?? undefined });
}

export function showWorkspaceContextMenu(sender: Electron.WebContents, relativePath: string, kind: WorkspaceEntry['kind']): void {
  const isFile = kind === 'file' || kind === 'symlink';
  const canPaste = getWorkspaceFileClipboard() !== null;
  const owner = rendererWindow(sender);
  const run = (command: WorkspaceContextCommand): void => {
    if (command === 'rename') {
      sender.send('workspace.contextCommand', command, relativePath);
      return;
    }
    if (command === 'delete') {
      void deleteWorkspaceEntry({ relativePath }, owner).then((result) => {
        if (!result.ok && result.code !== 'CANCELLED') void showMessageBoxFor(owner, { type: 'error', message: result.message });
      });
      return;
    }
    if (command === 'openPreview') { void openWorkspacePreview(relativePath); return; }
    if (command === 'openWith') { showOpenWithPicker(relativePath, owner); return; }
    if (command === 'openDefault') { void shell.openPath(workspaceEntryAbsolutePath(relativePath)); return; }
    if (command === 'reveal') { shell.showItemInFolder(workspaceEntryAbsolutePath(relativePath)); return; }
    if (command === 'copy') {
      const result = copyWorkspaceEntryToClipboard(relativePath);
      if (!result.ok) void showMessageBoxFor(owner, { type: 'error', message: result.message });
      return;
    }
    if (command === 'paste') {
      void pasteWorkspaceClipboard({ targetRelativePath: relativePath }, owner).then((result) => {
        if (result.ok) sender.send('workspace.contextCommand', 'paste', result.value.relativePath);
      });
      return;
    }
    const rootPath = workspaceRoot();
    if (!rootPath) return;
    const paths = workspaceCore.resourcePaths(relativePath);
    clipboard.writeText(command === 'copyPath' ? paths.absolutePath : paths.relativePath);
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: tWorkspace('menu.openPreview'), enabled: isFile, click: () => run('openPreview') },
    { label: tWorkspace('menu.openWith'), enabled: isFile, click: () => run('openWith') },
    { label: tWorkspace('menu.openDefault'), enabled: isFile, click: () => run('openDefault') },
    { label: tWorkspace(process.platform === 'darwin' ? 'menu.revealInFinder' : 'menu.revealInFileExplorer'), click: () => run('reveal') },
    { type: 'separator' },
    { label: tWorkspace('menu.copy'), accelerator: 'CmdOrCtrl+C', click: () => run('copy') },
    { label: tWorkspace('menu.paste'), accelerator: 'CmdOrCtrl+V', enabled: canPaste, click: () => run('paste') },
    { label: tWorkspace('menu.copyPath'), click: () => run('copyPath') },
    { label: tWorkspace('menu.copyRelativePath'), click: () => run('copyRelativePath') },
    { type: 'separator' },
    { label: tWorkspace('menu.rename'), click: () => run('rename') },
    { label: tWorkspace('menu.delete'), accelerator: process.platform === 'darwin' ? 'Cmd+Backspace' : 'Delete', click: () => run('delete') },
  ];
  Menu.buildFromTemplate(template).popup({ window: owner ?? undefined });
}

export function showTabContextMenu(sender: Electron.WebContents, tabId: string): void {
  const tab = tabRegistry.get(tabId);
  if (!tab) return;
  const run = (command: DesktopTabContextCommand): void => {
    void executeTabContextCommand(tabId, command).then((result) => {
      if (!result.ok) void showMessageBoxFor(rendererWindow(sender), { type: 'info', message: result.message });
    });
  };
  const splitEnabled = tabSnapshot().splitRenderingAvailable;
  Menu.buildFromTemplate([
    { label: tWorkspace('tabMenu.close'), accelerator: DESKTOP_TAB_CLOSE_SHORTCUT.accelerator, registerAccelerator: false, click: () => run('close') },
    { label: tWorkspace('tabMenu.closeOthers'), click: () => run('closeOthers') },
    { label: tWorkspace('tabMenu.closeAll'), click: () => run('closeAll') },
    { type: 'separator' },
    { label: tWorkspace('menu.copyPath'), click: () => run('copyPath') },
    { label: tWorkspace('menu.copyRelativePath'), click: () => run('copyRelativePath') },
    { type: 'separator' },
    { label: tWorkspace('tabMenu.revealInIndexArea'), click: () => run('revealInIndexArea') },
    { type: 'separator' },
    ...(tab.kind === 'history' ? [] : [
      tab.pinned
        ? { label: tWorkspace('tabMenu.unpin'), click: () => run('unpin') }
        : { label: tWorkspace('tabMenu.pin'), click: () => run('pin') },
      { type: 'separator' as const },
    ]),
    { label: tWorkspace('tabMenu.splitAndMove'), submenu: [
      { label: tWorkspace('tabMenu.splitUp'), enabled: splitEnabled, click: () => run('splitUp') },
      { label: tWorkspace('tabMenu.splitDown'), enabled: splitEnabled, click: () => run('splitDown') },
      { label: tWorkspace('tabMenu.splitLeft'), enabled: splitEnabled, click: () => run('splitLeft') },
      { label: tWorkspace('tabMenu.splitRight'), enabled: splitEnabled, click: () => run('splitRight') },
      { type: 'separator' },
      { label: tWorkspace('tabMenu.moveNewWindow'), enabled: splitEnabled, click: () => run('moveNewWindow') },
    ] },
  ]).popup({ window: rendererWindow(sender) ?? undefined });
}
