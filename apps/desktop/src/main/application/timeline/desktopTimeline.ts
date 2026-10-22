import { dialog } from 'electron';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { TimelineChannel, readHistoryText } from '@easyview/node-runtime';
import { isMarkdownFilePath, type TimelineRequestMessage, type TimelineComparison } from '@easyview/contracts';
import { desktopHistory } from '../document/desktopHistory';
import { readDocument, publishSaveOutcome } from '../document/documentWorkflow';
import { getMainWindow, workspaceRoot, documentSessions, tabRegistry, syncTabState, sendToWindow, sendEditorMessage, editorDocumentMessage, windowSessions } from '../host/desktopRuntime';
import { tTimeline } from './desktopTimeline.i18n';
const channels = new Map<number, Promise<TimelineChannel>>();
const comparisons = new Map<string, TimelineComparison>();
export function getHistoryComparison(tabId: string): TimelineComparison | undefined { const tab = tabRegistry.get(tabId); return tab?.kind === 'history' ? comparisons.get(tab.comparisonKey) : undefined; }
export function releaseHistoryComparison(tabId: string): void { clearHistoryComparisons([tabId]); }
export function clearHistoryComparisons(tabIds: string[]): void {
  const closing = new Set(tabIds);
  const snapshots = [tabRegistry.snapshot(), ...[...windowSessions.values()].map((window) => window.context.tabs.snapshot())];
  const remaining = snapshots.flatMap((snapshot) => snapshot.groups.flatMap((group) => group.tabs)).filter((tab) => tab.kind === 'history' && !closing.has(tab.id));
  for (const key of comparisons.keys()) if (!remaining.some((tab) => tab.kind === 'history' && tab.comparisonKey === key)) comparisons.delete(key);
}
export function openReadOnlyComparison(comparison: TimelineComparison): void {
  const tab = tabRegistry.openHistory(comparison);
  if (tab.kind === 'history') comparisons.set(tab.comparisonKey, comparison);
  syncTabState();
}

export async function handleDesktopTimeline(sender: Electron.WebContents, message: TimelineRequestMessage): Promise<void> {
  let channel = channels.get(sender.id);
  if (!channel) {
    channel = desktopHistory().then((service) => new TimelineChannel({
      service,
      authorize: async (filePath) => {
        const root = workspaceRoot(); if (!root || !filePath || !isMarkdownFilePath(filePath)) throw new Error(tTimeline('authorize.selectMarkdown'));
        const resolved = await realpath(path.resolve(root, filePath)); const canonicalRoot = await realpath(root);
        const relative = path.relative(canonicalRoot, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(tTimeline('authorize.outsideWorkspace'));
        return resolved;
      },
      reveal: (entry) => { const tab = tabRegistry.snapshot().groups.flatMap((group) => group.tabs).find((tab) => tab.kind === 'history' && tab.comparisonKey.endsWith(`:${entry.filePath}:${entry.source}:${entry.id}`)); if (!tab) return false; tabRegistry.activate(tab.id); syncTabState(); return true; },
      current: async (filePath) => documentSessions.findByFilePath(filePath)[0]?.rawContent ?? readHistoryText(filePath),
      open: async (comparison, signal) => {
        signal.throwIfAborted();
        const tab = tabRegistry.openHistory(comparison);
        if (tab.kind === 'history' && !comparisons.has(tab.comparisonKey)) comparisons.set(tab.comparisonKey, comparison);
        syncTabState();
      },
      restore: async (entry, signal) => {
        let session = documentSessions.findByFilePath(entry.filePath)[0];
        if (!session) { const result = await readDocument(entry.filePath); if (!result.ok) throw new Error(result.message); session = documentSessions.findByFilePath(entry.filePath)[0]; }
        if (!session) throw new Error(tTimeline('restore.sessionNotFound'));
        const expectedContent = session.content, expectedDisk = await readHistoryText(entry.filePath, signal);
        const content = await service.read(entry, signal); signal.throwIfAborted();
        const confirm = await dialog.showMessageBox(getMainWindow()!, { type: 'question', buttons: [tTimeline('restore.cancel'), tTimeline('restore.confirm')], defaultId: 0, cancelId: 0, message: tTimeline('restore.message', { fileName: path.basename(entry.filePath) }), detail: tTimeline('restore.detail') });
        if (confirm.response !== 1) return;
        signal.throwIfAborted();
        const outcome = await documentSessions.restoreVersion(session.tabId, content, expectedContent, expectedDisk, service.local);
        if (outcome.kind === 'error') throw new Error(outcome.error.ok ? tTimeline('restore.failed') : outcome.error.message);
        await publishSaveOutcome(session.tabId, outcome);
        sendEditorMessage(editorDocumentMessage(session, 'reload'));
        sendToWindow('timeline.message', { type: 'timeline.changed' });
        if (outcome.kind === 'saved' && outcome.historyWarning) throw new Error(outcome.historyWarning);
      },
      post: (result) => { if (!sender.isDestroyed()) sender.send('timeline.message', result); },
    }));
    channels.set(sender.id, channel);
    sender.once('destroyed', () => { void channel?.then((value) => value.dispose()); channels.delete(sender.id); });
  }
  await (await channel).handle(message);
}

export async function desktopTimelineDiagnostics(senderId: number): Promise<{ queries: number; watchers: number; snapshots: number; requests: number; queues: number; pending: number }> {
  const channel = await channels.get(senderId); const service = await desktopHistory(); return { ...service.diagnostics, snapshots: comparisons.size, requests: channel?.diagnostics.requests ?? 0 };
}
