import { RpcTimelineClient } from '@easyview/editor-core/timeline';
import type { TimelineUiState } from '@easyview/contracts';
import './workspace-explorer.css';
import { WorkspaceExplorerView, type WorkspaceExplorerVsCodeApi } from './WorkspaceExplorerView';

declare function acquireVsCodeApi(): WorkspaceExplorerVsCodeApi;

const vscodeApi = acquireVsCodeApi();

function resolveMount(): HTMLElement {
  const existing = document.getElementById('workspace-explorer-root');
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = 'workspace-explorer-root';
  document.body.replaceChildren(root);
  return root;
}

const timeline = new RpcTimelineClient({
  post: (message) => vscodeApi.postMessage(message as any),
  subscribe: (listener) => { const handle = (event: MessageEvent) => listener(event.data); window.addEventListener('message', handle); return { dispose: () => window.removeEventListener('message', handle) }; },
  loadState: () => (vscodeApi.getState() as { timeline?: TimelineUiState } | undefined)?.timeline,
  saveState: (timeline) => vscodeApi.setState({ ...(vscodeApi.getState() as object ?? {}), timeline }),
});
const view = new WorkspaceExplorerView(resolveMount(), vscodeApi, timeline);
window.addEventListener('pagehide', () => { view.dispose(); timeline.dispose(); });

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if ((event.data as { type?: string }).type === 'timeline.visibility') view.setTimelineVisible((event.data as { visible: boolean }).visible);
  else view.handleEvent(event.data);
});

vscodeApi.postMessage({ type: 'ready' });

export { WorkspaceExplorerView };
export type { WorkspaceExplorerVsCodeApi };
