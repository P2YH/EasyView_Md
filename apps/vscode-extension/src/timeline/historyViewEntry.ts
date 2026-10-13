import { HistoryView } from '@easyview/editor-core/timeline';
import type { TimelineComparison } from '@easyview/contracts';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const api = acquireVsCodeApi();
let view: HistoryView | undefined;
window.addEventListener('message', (event: MessageEvent<{ type: string; comparison: TimelineComparison; workerUrl: string }>) => {
  if (event.data.type !== 'history.init') return;
  view?.dispose(); view = new HistoryView(document.getElementById('history-root')!, event.data.comparison, event.data.workerUrl);
});
window.addEventListener('pagehide', () => { view?.dispose(); view = undefined; });
api.postMessage({ type: 'history.ready' });
