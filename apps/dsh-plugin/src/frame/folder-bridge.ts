/** Only a trusted DSH parent can pick/register a directory; frames never submit host paths. */
export function createFolderBridge(params: URLSearchParams, signal: AbortSignal) {
  const channel = params.get('channel'), workbenchId = params.get('workbenchId');
  const pending = new Map<string, { resolve(value: string | null): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  window.addEventListener('message', event => {
    const value = event.data;
    if (event.origin !== location.origin || event.source !== window.parent || !value || value.protocol !== 'easyview.workbench.v1'
      || value.channel !== channel || value.workbenchId !== workbenchId || value.type !== 'host-result') return;
    const request = pending.get(value.requestId); if (!request) return;
    pending.delete(value.requestId); clearTimeout(request.timer);
    if (value.ok && (value.value === null || typeof value.value === 'string')) request.resolve(value.value);
    else request.reject(new Error('打开文件夹失败，请重试或检查 DSH 目录权限。'));
  }, { signal });
  signal.addEventListener('abort', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('工作台已关闭。')); }
    pending.clear();
  }, { once: true });
  return () => new Promise<string | null>((resolve, reject) => {
    if (signal.aborted || window.parent === window || !channel || !/^[a-f0-9-]{36}$/.test(channel) || !workbenchId) {
      reject(new Error('请通过 DSH 文档工作台打开文件夹。')); return;
    }
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('目录选择超时，请重试。')); }, 300_000);
    pending.set(requestId, { resolve, reject, timer });
    window.parent.postMessage({ protocol: 'easyview.workbench.v1', channel, workbenchId, type: 'host-request', command: 'openFolder', requestId }, location.origin);
  });
}
