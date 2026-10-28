/** Original editor-sync protocol: an edit ACK is emitted only after a Host checkpoint. */
import type { EditorToHostMessage, HostToEditorMessage, PreviewDescriptor } from '@easyview/contracts';
import type { EasyViewBootstrap } from '../shared/contracts';
import type { PreviewWriteResult } from '@easyview/contracts';
import { applyAiTextPatches } from '@easyview/contracts';
import { hashContent } from '@easyview/editor-sync';
import type { DocumentEditorLifecycle } from '@easyview/contracts';

interface TextDocument {
  generation: string; descriptor: PreviewDescriptor; content: string; revision: number;
  contentHash: string; dirty: boolean; pending: Promise<void>; retry?: () => Promise<void>;
  diskHash: string; format: string; savedEditorRevision: number; editor?: DocumentEditorLifecycle; saving?: Promise<PreviewWriteResult>;
  pendingSave?: { requestId: string; revision: number; content: string; diskHash: string };
  aiOperation?: { operationId: string; baseRevision: number; resultHash: string };
}
export function createTextOwner(bootstrap: EasyViewBootstrap, workbenchId: string,
  emit: (message: HostToEditorMessage) => void, show: (state: string, message: string, recoveryUrl?: string) => void) {
  const documents = new Map<string, TextDocument>();
  const abort = new AbortController();
  const flushes = new Map<string, { complete(error?: string): void }>();
  const endpoint = (name: string, documentId: string, generation: string) =>
    `/api/easyview/v1/${name}?${new URLSearchParams({ documentId, workbenchId, generation })}`;
  async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
    abort.signal.throwIfAborted();
    const response = await fetch(url, { ...init, credentials: 'same-origin', signal: abort.signal });
    const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.message || `文本宿主 HTTP ${response.status}`);
    return body.value;
  }
  async function open(descriptor: PreviewDescriptor): Promise<boolean> {
    const generation = crypto.randomUUID();
    const attachment = await json<{ conflict: boolean; contentUrl: string; diskHash: string; format: string }>('/api/easyview/v1/draft-attach', {
      method: 'POST', body: JSON.stringify({ documentId: descriptor.sessionId, workbenchId, generation }) });
    if (attachment.conflict) { show('conflict', '原件与恢复草稿的基线不同，当前原件只读。', attachment.contentUrl); return false; }
    const snapshot = await json<{ content: string; contentHash: string; revision: number; dirty: boolean; savedEditorRevision: number }>(endpoint('text-snapshot', descriptor.sessionId, generation));
    documents.set(descriptor.sessionId, { generation, descriptor, ...snapshot, diskHash: attachment.diskHash, format: attachment.format, pending: Promise.resolve() });
    activate(descriptor.sessionId);
    show(snapshot.dirty ? 'confirmed' : 'ready', snapshot.dirty ? '已恢复已确认的文本草稿；原件未保存。' : (bootstrap.capabilities.save ? '文本编辑将保存恢复草稿；点击保存可写回原件。' : '文本编辑将持久化为恢复草稿；原件保存暂未启用。'));
    return true;
  }
  function activate(documentId: string) {
    const session = documents.get(documentId); if (!session) return;
    emit({ type: 'documentSnapshot', documentId, revision: session.revision, content: session.content,
      editorBaseline: { sourceDiskHash: session.diskHash, format: session.format as 'markdown' | 'text', savedEditorRevision: session.savedEditorRevision },
      contentHash: session.contentHash, filename: session.descriptor.fileName, filePath: session.descriptor.relativePath, reason: 'visible' });
  }
  function handle(message: EditorToHostMessage): boolean {
    if (message.type === 'documentFlushed') { flushes.get(message.requestId)?.complete(message.error); return true; }
    if (message.type !== 'applyEdits' && message.type !== 'requestResync' && message.type !== 'snapshotApplied' && message.type !== 'updateUiState') return false;
    const session = documents.get(message.documentId);
    if (!session) return true;
    if (message.type === 'applyEdits') {
      const aiOperationId = session.aiOperation?.baseRevision === message.baseRevision && session.aiOperation.resultHash === message.resultHash
        ? session.aiOperation.operationId : undefined;
      const payload = JSON.stringify({ clientEditId: message.clientEditId, baseRevision: message.baseRevision, edits: message.edits, resultHash: message.resultHash, aiOperationId });
      const send = async () => {
        show('pending', '文本恢复草稿同步中；原件未保存。');
        const result = await json<{ revision: number; resultHash: string; checkpointRevision: number }>(endpoint('text-edits', message.documentId, session.generation), { method: 'POST', body: payload });
        // Fetching a new authoritative snapshot is unnecessary: only this one in-flight
        // edit can advance this generation, and editor-sync owns the optimistic body.
        const { applyTextPatches } = await import('@easyview/editor-sync');
        if (result.revision > session.revision) session.content = applyTextPatches(session.content, message.edits);
        session.revision = result.revision; session.contentHash = result.resultHash; session.dirty = true; session.retry = undefined;
        show('confirmed', `文本恢复草稿已确认（版本 ${result.checkpointRevision}）；原件未保存。`);
        emit({ type: 'editsApplied', documentId: message.documentId, clientEditId: message.clientEditId, revision: result.revision, resultHash: result.resultHash });
      };
      session.retry = send;
      session.pending = (async () => {
        for (let attempt = 0; ; attempt++) {
          try { await send(); return; }
          catch (error) {
            if (abort.signal.aborted) return;
            show('failed', `文本恢复草稿同步失败：${String(error)}。当前输入仍保留。`);
            if (attempt >= bootstrap.checkpointPolicy.maxRetries) return;
            await new Promise<void>(resolve => { const timer = setTimeout(resolve, bootstrap.checkpointPolicy.delayMs);
              abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
          }
        }
      })();
    } else if (message.type === 'requestResync') {
      // Replacing optimistic content after a failure could discard user input.
      show('failed', '文本同步出现版本冲突，请保留当前输入后重新打开；恢复草稿仍保留。');
    }
    return true;
  }
  async function flush(): Promise<void> {
    for (const session of documents.values()) {
      await session.pending;
      if (session.retry) await session.retry();
      const requestId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const complete = (error?: string) => { clearTimeout(timer); flushes.delete(requestId); if (error) reject(new Error(error)); else resolve(); };
        const timer = setTimeout(() => complete('文本编辑器尚未确认最新内容。'), 8000);
        flushes.set(requestId, { complete }); emit({ type: 'flushDocument', requestId, documentId: session.descriptor.sessionId });
      });
    }
  }
  async function save(documentId: string): Promise<PreviewWriteResult> {
    const session = documents.get(documentId); if (!session || !bootstrap.capabilities.save) throw new Error('原件保存不可用。');
    if (session.saving) return session.saving;
    session.saving = saveOnce(documentId, session);
    try { return await session.saving; } finally { session.saving = undefined; }
  }
  async function saveOnce(documentId: string, session: TextDocument): Promise<PreviewWriteResult> {
    const deadline = Date.now() + 8000;
    while (!session.editor) {
      abort.signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('文本编辑器尚未就绪，请激活文档后重试。');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const editor = session.editor;
    if (!session.pendingSave) {
      await flush();
      const captured = await editor.capture(abort.signal);
      if (captured.editorRevision !== session.revision || new TextDecoder().decode(captured.bytes) !== session.content) throw new Error('文本内容尚未确认，请重试。');
      session.pendingSave = { requestId: crypto.randomUUID(), revision: session.revision, content: session.content, diskHash: session.diskHash };
    }
    const pending = session.pendingSave;
    const lease = await editor.acquireCommitLease(pending.revision, abort.signal);
    try {
    const result = await json<PreviewWriteResult>(endpoint('save', documentId, session.generation), { method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-easyview-save': JSON.stringify({ requestId: pending.requestId,
        editorRevision: pending.revision, sourceDiskHash: pending.diskHash, format: session.format }) }, body: new TextEncoder().encode(pending.content).buffer });
    session.diskHash = result.diskHash!; session.pendingSave = undefined;
    session.savedEditorRevision = result.savedEditorRevision ?? pending.revision;
    editor.acknowledgeSaved(session.savedEditorRevision, result.diskHash!);
    session.dirty = session.revision !== pending.revision;
    show('saved', session.dirty ? '原件已保存上一确认版本；新输入仍是未保存草稿。' : '原件已保存并核对文件哈希。');
    return result;
    } finally { lease.release(); }
  }
  function dispose() { abort.abort(); documents.clear(); for (const flush of flushes.values()) flush.complete('工作台已卸载。'); flushes.clear(); }
  return { open, activate, handle, flush, save, dispose,
    async withCleanLease<T>(documentId: string, action: (revision: number) => Promise<T>): Promise<T> {
      const session = documents.get(documentId);
      if (!session?.editor || session.pendingSave || session.saving) throw new Error('请先等待当前保存结束。');
      await flush();
      const editor = session.editor, state = editor.snapshot();
      if (state.dirty || session.dirty) throw new Error('请先保存或明确丢弃当前修改，再撤销文件保存。');
      const lease = await editor.acquireCommitLease(state.editorRevision, abort.signal);
      try { return await action(lease.revision); } finally { lease.release(); }
    },
    register(editor: DocumentEditorLifecycle) {
      const session = documents.get(editor.snapshot().documentId);
      if (!session) throw new Error('文本挂载身份已失效。');
      session.editor = editor;
      return () => { if (session.editor === editor) session.editor = undefined; };
    },
    context: (documentId: string) => { const session = documents.get(documentId); return session ? { documentId, generation: session.generation } : {}; },
    beginAiOperation(documentId: string, operation: Extract<HostToEditorMessage, { type: 'aiChat.applyPatches' }>) {
      const session = documents.get(documentId);
      if (!session || session.retry) throw new Error('文本尚未完成同步，无法应用 AI 修改。');
      session.aiOperation = { operationId: operation.operationId, baseRevision: session.revision,
        resultHash: hashContent(applyAiTextPatches(session.content, operation.patches)) };
    },
    forget(ids: string[]) { for (const id of ids) documents.delete(id); },
    has: (id: string) => documents.has(id) };
}
