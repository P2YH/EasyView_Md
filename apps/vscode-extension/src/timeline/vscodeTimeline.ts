import { minimatch } from 'minimatch';
import * as vscode from 'vscode';
import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import { TimelineChannel, TimelineService, discoverHostHistoryRoots, contentHash, readHistoryText, migrateRenamedHistory } from '@easyview/node-runtime';
import { DEFAULT_LOCAL_HISTORY_SETTINGS, isTimelineMarkdown, type LocalHistorySettings, type TimelineComparison, type TimelineEntry, type TimelineResultMessage } from '@easyview/contracts';
import { resolveMarkdownDiskUri } from '../application/document/openMarkdownEditor';
import { MarkdownEditorProvider } from '../adapters/vscode/provider';
import { getLocale } from '@easyview/contracts/i18n';
import { tTimeline } from './timeline.i18n';
export class VscodeTimeline {
  private disposed = false;
  private servicePromise?: Promise<TimelineService>;
  private panels = new Map<string, vscode.WebviewPanel>();
  private subscriptions: vscode.Disposable[] = [];
  private channels = new Set<TimelineChannel>();
  constructor(private context: vscode.ExtensionContext) {
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
      const disk = resolveMarkdownDiskUri(document.uri);
      if (!isTimelineMarkdown(disk.fsPath) || disk.scheme !== 'file') return;
      void this.capture(disk.fsPath, document.getText(), tTimeline('label.saved'));
    }));
    this.subscriptions.push(vscode.workspace.onDidRenameFiles((event) => {
      void this.service().then(async (service) => { for (const file of event.files) await migrateRenamedHistory(service.local, file.oldUri.fsPath, file.newUri.fsPath); }).catch((error) => this.report(error));
    }));
  }
  async service(): Promise<TimelineService> {
    return this.servicePromise ??= discoverHostHistoryRoots(this.userDataPath(), /cursor/i.test(vscode.env.appName) ? 'cursor' : 'vscode').then((roots) => new TimelineService(path.join(this.context.globalStorageUri.fsPath, 'timeline'), roots));
  }
  private userDataPath(): string {
    const directory = this.context.globalStorageUri.fsPath;
    const marker = `${path.sep}User${path.sep}`;
    const index = directory.indexOf(marker);
    return index >= 0 ? directory.slice(0, index) : path.resolve(directory, '../../..');
  }
  settings(filePath: string): LocalHistorySettings {
    const config = vscode.workspace.getConfiguration('workbench.localHistory', vscode.Uri.file(filePath));
    const settings = { ...DEFAULT_LOCAL_HISTORY_SETTINGS };
    for (const key of ['enabled','maxFileSize','maxFileEntries','mergeWindow'] as const) Object.assign(settings, { [key]: config.get(key, settings[key]) });
    const exclude = config.get<Record<string, boolean>>('exclude', {});
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath;
    const relative = (folder ? path.relative(folder, filePath) : path.basename(filePath)).replace(/\\/g, '/');
    for (const [pattern, excluded] of Object.entries(exclude)) if (excluded && (minimatch(relative, pattern, { matchBase: true, dot: true }) || minimatch(filePath.replace(/\\/g, '/'), pattern, { matchBase: true, dot: true }))) settings.enabled = false;
    return settings;
  }
  async capture(filePath: string, content?: string, label = tTimeline('label.externalChange')): Promise<void> {
    try { if (this.disposed) return; filePath = await realpath(filePath); const settings = this.settings(filePath); if (!settings.enabled || !settings.maxFileEntries || (!content && (await stat(filePath)).size > settings.maxFileSize * 1024)) return; await (await this.service()).local.capture(filePath, content ?? await readFile(filePath, 'utf8'), label, settings); }
    catch (error) { this.report(error); }
  }
  async channel(root: () => string | undefined, post: (message: TimelineResultMessage) => void): Promise<TimelineChannel> {
    const service = await this.service();
    if (this.disposed) throw new Error(tTimeline('error.closed'));
    const channel = new TimelineChannel({
      service, post,
      authorize: async (filePath) => {
        const folder = root(); if (!folder || !filePath) throw new Error(tTimeline('error.selectWorkspaceFile'));
        const resolved = await realpath(path.resolve(folder, filePath)), relative = path.relative(await realpath(folder), resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !isTimelineMarkdown(resolved)) throw new Error(tTimeline('error.notWorkspaceMarkdown'));
        return resolved;
      },
      reveal: (entry) => { const panel = this.panels.get(`${entry.filePath}:${entry.source}:${entry.id}`); if (!panel) return false; panel.reveal(); return true; },
      current: (filePath) => this.current(filePath),
      open: (comparison, signal) => this.open(comparison, signal),
      restore: (entry, signal) => this.restore(entry, signal),
    });
    this.channels.add(channel); return channel;
  }
  current(filePath: string): Promise<string> {
    const document = this.documents(filePath).find((doc) => doc.isDirty) ?? this.documents(filePath)[0];
    return document ? Promise.resolve(document.getText()) : readHistoryText(filePath);
  }
  private documents(filePath: string): vscode.TextDocument[] { return vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme !== 'untitled' && resolveMarkdownDiskUri(doc.uri).fsPath === filePath); }
  private async open(comparison: TimelineComparison, signal: AbortSignal): Promise<void> {
    const key = `${comparison.entry.filePath}:${comparison.entry.source}:${comparison.entry.id}`;
    const existing = this.panels.get(key); if (existing) { existing.reveal(); return; }
    signal.throwIfAborted();
    const panel = vscode.window.createWebviewPanel('easyviewMd.history', `${path.basename(comparison.entry.filePath)} · ${comparison.contentLabel}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] });
    this.panels.set(key, panel);
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'history-view.js'));
    const workerUrl = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'history-diff-worker.js')).toString();
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    panel.webview.html = `<!doctype html><html lang="${getLocale()}"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource}; worker-src blob:; connect-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline';"><link rel="stylesheet" href="${css}"></head><body style="padding:0;height:100vh;overflow:hidden"><main id="history-root"></main><script type="module" src="${script}"></script></body></html>`;
    const listener = panel.webview.onDidReceiveMessage((message) => { if (message.type === 'history.ready') void panel.webview.postMessage({ type: 'history.init', comparison, workerUrl }); });
    const closed = panel.onDidDispose(() => { listener.dispose(); closed.dispose(); this.panels.delete(key); });
  }
  private async restore(entry: TimelineEntry, signal: AbortSignal): Promise<void> {
    const service = await this.service();
    const disk = await readHistoryText(entry.filePath, signal);
    const documents = this.documents(entry.filePath);
    const baselines = documents.map((document) => ({ document, version: document.version, content: document.getText() }));
    const version = await service.read(entry, signal); signal.throwIfAborted();
    const restoreAction = tTimeline('restore.action');
    const confirmed = await vscode.window.showWarningMessage(tTimeline('restore.confirm', { name: path.basename(entry.filePath) }), { modal: true }, restoreAction);
    if (confirmed !== restoreAction) return;
    signal.throwIfAborted();
    await service.local.preserve(entry.filePath, disk, tTimeline('label.beforeRestoreDisk'));
    for (const baseline of baselines) if (baseline.content !== disk) await service.local.preserve(entry.filePath, baseline.content, tTimeline('label.beforeRestoreUnsaved'));
    if (contentHash(await readFile(entry.filePath, 'utf8')) !== contentHash(disk) || baselines.some((baseline) => baseline.document.version !== baseline.version)) throw new Error(tTimeline('error.changedDuringConfirm'));
    signal.throwIfAborted();
    const target = documents[0] ?? await vscode.workspace.openTextDocument(vscode.Uri.file(entry.filePath));
    const edit = new vscode.WorkspaceEdit();
    for (const document of documents.length ? documents : [target]) edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), version);
    if (!await vscode.workspace.applyEdit(edit) || !await target.save()) throw new Error(tTimeline('error.restoreSaveFailed'));
    await MarkdownEditorProvider.reloadPanelsForDocument(vscode.Uri.file(entry.filePath), version);
    try { await service.local.preserve(entry.filePath, version, tTimeline('label.restored')); } catch (error) { throw new Error(tTimeline('error.restoredWithoutHistory', { message: error instanceof Error ? error.message : String(error) })); }
  }
  releaseChannel(channel: TimelineChannel): void { channel.dispose(); this.channels.delete(channel); }
  report(error: unknown): void { console.warn('[EasyView Timeline]', error); }
  dispose(): void {
    this.disposed = true;
    for (const channel of this.channels) channel.dispose(); this.channels.clear();
    for (const panel of this.panels.values()) panel.dispose(); this.panels.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
    void this.servicePromise?.then((service) => service.dispose());
  }
}
