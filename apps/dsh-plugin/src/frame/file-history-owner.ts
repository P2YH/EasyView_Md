/** File saves have a separate guarded undo from the editor's local Undo. */
interface HistoryEntry { operationId: string; kind: 'save' | 'undo' | 'create'; state: string; createdAt: string; canUndo: boolean }
export function createFileHistoryOwner(options: {
  context(): { documentId: string; workbenchId: string; generation: string; path: string } | null;
  withCleanLease<T>(documentId: string, action: (revision: number) => Promise<T>): Promise<T>;
  retire(documentId: string): Promise<void>;
  reopen(path: string): Promise<void>;
}) {
  const lifetime = new AbortController();
  const button = document.createElement('button'); button.type = 'button'; button.className = 'desktop-title-button';
  button.title = '保存记录'; button.setAttribute('aria-label', '保存记录');
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7a6 6 0 1 1 1.5 5M2 3v4h4M8 4v4l2 1"/></svg>';
  button.dataset.easyviewFileHistory = '';
  document.getElementById('desktop-title-actions')!.prepend(button);
  let dialog: HTMLDialogElement | null = null;
  async function json<T>(name: string, context: NonNullable<ReturnType<typeof options.context>>, init: RequestInit = {}): Promise<T> {
    const { documentId, workbenchId, generation } = context;
    const response = await fetch(`/api/easyview/v1/${name}?${new URLSearchParams({ documentId, workbenchId, generation })}`, {
      ...init, credentials: 'same-origin', signal: lifetime.signal });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || '保存记录读取失败。');
    return result.value;
  }
  button.onclick = () => { void open(); };
  async function open() {
    if (dialog || lifetime.signal.aborted) return;
    const context = options.context();
    if (!context) { window.alert('请先激活一个可编辑文档。'); return; }
    const panel = document.createElement('dialog'); dialog = panel; panel.dataset.easyviewHistoryDialog = '';
    Object.assign(panel.style, { maxWidth: 'min(720px, 90vw)', maxHeight: '80vh', overflow: 'auto', padding: '20px', border: '1px solid var(--easyview-border)',
      borderRadius: '8px', background: 'var(--easyview-editor-background)', color: 'var(--easyview-editor-foreground)', font: '14px system-ui' });
    const heading = document.createElement('h3'); heading.textContent = `${context.path} · 保存记录`; panel.append(heading);
    const description = document.createElement('p'); description.textContent = '文件撤销会恢复该次保存前的原件。请先保存或丢弃当前修改。'; panel.append(description);
    const content = document.createElement('div'); content.textContent = '正在读取…'; panel.append(content);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); panel.append(status);
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => panel.close(); panel.append(close);
    let busy = false;
    panel.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    panel.addEventListener('close', () => { panel.remove(); if (dialog === panel) dialog = null; }, { once: true });
    document.body.append(panel); panel.showModal();
    try {
      const records = await json<HistoryEntry[]>('operations', context);
      if (!panel.isConnected) return;
      content.textContent = records.length ? '' : '还没有文件保存记录。';
      for (const record of records) {
        const row = document.createElement('p'); row.dataset.operationId = record.operationId;
        const kind = record.kind === 'undo' ? '撤销' : record.kind === 'create' ? '新建' : '保存';
        row.textContent = `${new Date(record.createdAt).toLocaleString()} · ${kind} · ${record.state === 'committed' ? '已完成' : record.state}`;
        if (record.canUndo) {
          const undo = document.createElement('button'); undo.textContent = '撤销此次保存'; row.append(' ', undo);
          const requestId = crypto.randomUUID(); // One identity survives uncertain ACK/retry.
          undo.onclick = () => { void (async () => {
            if (busy) return;
            const current = options.context();
            if (!current || current.documentId !== context.documentId || current.generation !== context.generation) { status.textContent = '文档已切换，请重新打开保存记录。'; return; }
            busy = true; close.disabled = true;
            for (const element of content.querySelectorAll('button')) element.disabled = true;
            try {
              await options.withCleanLease(context.documentId, async revision => {
                await json('undo', context, { method: 'POST', body: JSON.stringify({ requestId, operationId: record.operationId, editorRevision: revision }) });
                // Remove the old mounted editor while it still holds its input lease.
                await options.retire(context.documentId);
              });
              await options.reopen(context.path); panel.close();
            } catch (error) { if (!lifetime.signal.aborted) status.textContent = String(error); }
            finally { busy = false; close.disabled = false; for (const element of content.querySelectorAll('button')) element.disabled = false; }
          })(); };
        }
        content.append(row);
      }
    } catch (error) { if (!lifetime.signal.aborted && panel.isConnected) status.textContent = String(error); }
  }
  return { dispose() { lifetime.abort(); dialog?.close(); dialog?.remove(); dialog = null; button.remove(); } };
}
