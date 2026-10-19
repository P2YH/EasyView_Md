import type {
  EditorHostTransport,
  EditorToHostMessage,
  HostToEditorMessage,
} from '@easyview/contracts';
import type { VscodeEditorHostActionMessage } from './vscodeProtocol';
import type { EasyViewEditorInstance } from '@easyview/editor-core';

interface VscodeWebviewApi {
  postMessage(message: EditorToHostMessage | VscodeEditorHostActionMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VscodeWebviewApi;

const vscodeApi = acquireVsCodeApi();
const epochNow = (): number => performance.timeOrigin + performance.now();
const bootMarks: Record<string, number> = { navigationStart: performance.timeOrigin, entryScriptStart: epochNow() };
type InitialSnapshot = Extract<HostToEditorMessage, { type: 'documentSnapshot' }>;
const listeners = new Set<(message: HostToEditorMessage) => void>();
const pendingMessages: HostToEditorMessage[] = [];
let resolveSnapshot!: (snapshot: InitialSnapshot) => void;
const snapshotReady = new Promise<InitialSnapshot>((resolve) => { resolveSnapshot = resolve; });
let receivedSnapshot = false;
let runtimeReady = false;
let disposed = false;
let editor: EasyViewEditorInstance | undefined;
const receiveMessage = (event: MessageEvent<HostToEditorMessage>): void => {
  const message = event.data;
  if (!receivedSnapshot && message?.type === 'documentSnapshot') {
    receivedSnapshot = true;
    bootMarks.snapshotReceived = epochNow();
    resolveSnapshot(message);
  } else if (runtimeReady) {
    listeners.forEach(listener => listener(message));
  } else {
    pendingMessages.push(message);
  }
};
window.addEventListener('message', receiveMessage);
const transport: EditorHostTransport = {
  capabilities: {
    sourceMode: 'native',
    git: true,
    terminal: true,
    aiCommitMessage: true,
    aiChat: true,
    documentConversion: true,
    shortcutPersistence: true,
  },
  postMessage(message) {
    vscodeApi.postMessage(message);
  },
  subscribe(listener) {
    listeners.add(listener);
    return { unsubscribe() { listeners.delete(listener); } };
  },
};

// Receive the canonical document while the editing runtime loads, rather than after full UI setup.
const runtime = import('@easyview/editor-core').then((module) => {
  bootMarks.editorModuleLoaded = epochNow();
  return module;
});
const domReady = document.readyState === 'loading'
  ? new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
  : Promise.resolve();
vscodeApi.postMessage({ type: 'ready' });

function reportBootTiming(): void {
  bootMarks.firstFrame = epochNow();
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const scripts = resources.filter(entry => /\.js(\?|$)/.test(entry.name));
  const styles = resources.filter(entry => /\.css(\?|$)/.test(entry.name));
  const lastEnd = (entries: PerformanceResourceTiming[]): number => Math.max(0, ...entries.map(entry => entry.responseEnd));
  if (styles.length) bootMarks.stylesLoaded = performance.timeOrigin + lastEnd(styles);
  if (scripts.length) bootMarks.scriptsLoaded = performance.timeOrigin + lastEnd(scripts);
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    if (navigation.workerStart) bootMarks.documentWorkerStart = performance.timeOrigin + navigation.workerStart;
    if (navigation.fetchStart) bootMarks.documentFetchStart = performance.timeOrigin + navigation.fetchStart;
    if (navigation.requestStart) bootMarks.documentRequestStart = performance.timeOrigin + navigation.requestStart;
    if (navigation.responseStart) bootMarks.documentResponseStart = performance.timeOrigin + navigation.responseStart;
    if (navigation.responseEnd) bootMarks.documentResponseEnd = performance.timeOrigin + navigation.responseEnd;
    if (navigation.domInteractive) bootMarks.domInteractive = performance.timeOrigin + navigation.domInteractive;
  }
  if (resources.length) bootMarks.firstResourceRequested = performance.timeOrigin + Math.min(...resources.map(entry => entry.startTime));
  const slowest = [...resources].sort((a, b) => b.duration - a.duration)[0];
  transport.postMessage({
    type: 'openWithDebugLog',
    stage: 'bootTiming',
    meta: {
      ...bootMarks,
      scriptCount: scripts.length,
      resourceCount: resources.length,
      slowestResource: slowest ? `${slowest.name.split('/').pop()?.split('?')[0]} ${Math.round(slowest.duration)}ms` : '',
      styleRequests: styles.map(entry => `${entry.name.split('/').pop()?.split('?')[0]}@${Math.round(entry.startTime)}-${Math.round(entry.responseEnd)}`).join(' '),
    },
  });
}

async function startEditor(): Promise<void> {
  const [{ createEasyViewEditor }, initialMessage] = await Promise.all([runtime, snapshotReady, domReady]);
  if (disposed) return;
  editor = createEasyViewEditor({
    host: transport,
    initialMessage,
    hostActions: {
      openSourceDocument(request) {
        vscodeApi.postMessage({ type: 'vscode.openSourceDocument', request });
      },
      persistOpenEditorShortcut(shortcut) {
        vscodeApi.postMessage({ type: 'vscode.persistOpenEditorShortcut', shortcut });
      },
      insertIntoITerm(prompt) {
        vscodeApi.postMessage({ type: 'vscode.insertIntoITerm', prompt });
      },
      openChatWithPrompt(prompt) {
        vscodeApi.postMessage({ type: 'vscode.openChatWithPrompt', prompt });
      },
    },
  });
  bootMarks.editorCreated = epochNow();
  runtimeReady = true;
  for (const message of pendingMessages.splice(0)) listeners.forEach(listener => listener(message));
  requestAnimationFrame(() => requestAnimationFrame(reportBootTiming));

  const savedState = vscodeApi.getState<{ version?: number; scrollRatio?: number }>();
  const scrollArea = document.getElementById('editor-scroll-area');
  if (scrollArea) {
    if (typeof savedState?.scrollRatio === 'number') {
      requestAnimationFrame(() => {
        scrollArea.scrollTop = Math.max(0, (scrollArea.scrollHeight - scrollArea.clientHeight) * savedState.scrollRatio!);
      });
    }
    scrollArea.addEventListener('scroll', () => {
      const denominator = Math.max(1, scrollArea.scrollHeight - scrollArea.clientHeight);
      vscodeApi.setState({ version: 1, scrollRatio: scrollArea.scrollTop / denominator });
    }, { passive: true });
  }
}
void startEditor().catch(error => {
  transport.postMessage({ type: 'webviewRuntimeError', source: 'editor-bootstrap', message: String(error), stack: error instanceof Error ? error.stack ?? '' : '' });
});
window.addEventListener('unload', () => {
  disposed = true;
  window.removeEventListener('message', receiveMessage);
  editor?.dispose();
  listeners.clear();
  pendingMessages.length = 0;
}, { once: true });
