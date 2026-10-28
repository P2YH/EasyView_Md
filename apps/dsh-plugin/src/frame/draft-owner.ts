/** Owns mounted Viewer generations and durable binary checkpoints in the browser. */
import { EditorCheckpointQueue, type DocumentEditorLifecycle, type DraftSnapshot } from '@easyview/preview-ui';
import type { EasyViewBootstrap } from '../shared/contracts';
import type { PreviewWriteResult } from '@easyview/contracts';

interface Attachment {
  format: string; diskHash: string; conflict: boolean; contentUrl: string;
  record: { editorRevision: number; checkpointRevision: number; savedEditorRevision?: number } | null;
}
interface Mount {
  generation: string; attachment: Attachment; recovery: Uint8Array | null;
  controller: AbortController; queue?: EditorCheckpointQueue; ready?: Promise<void>;
  editor?: DocumentEditorLifecycle;
  persist?: (snapshot: DraftSnapshot, signal: AbortSignal) => Promise<{ checkpointRevision: number }>;
  pendingSave?: { snapshot: DraftSnapshot; requestId: string };
}

export function createDraftOwner(bootstrap: EasyViewBootstrap, workbenchId: string) {
  const mounts = new Map<string, Mount>();
  let disposed = false;
  const status = document.createElement('aside');
  status.dataset.easyviewDraftStatus = 'idle'; status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'fixed', bottom: '5px', left: '8px', zIndex: '10000',
    maxWidth: '70vw', padding: '5px 10px', background: 'var(--vscode-editor-background, #fff)',
    color: 'var(--vscode-editor-foreground, #333)', border: '1px solid #8886', borderRadius: '5px', fontSize: '12px' });
  status.hidden = true; document.body.append(status);
  function show(state: string, message: string, recoveryUrl?: string) {
    status.dataset.easyviewDraftStatus = state; status.hidden = false; status.textContent = message;
    if (recoveryUrl) { const link = document.createElement('a'); link.href = recoveryUrl;
      link.download = ''; link.textContent = ' 下载恢复草稿'; status.append(link); }
  }
  async function json<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, credentials: 'same-origin' });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.message || `草稿宿主 HTTP ${response.status}`);
    return body.value;
  }
  function endpoint(name: string, documentId: string, mount: Mount) {
    const query = new URLSearchParams({ documentId, workbenchId, generation: mount.generation });
    return `/api/easyview/v1/${name}?${query}`;
  }
  async function prepare(documentId: string, fileName: string): Promise<void> {
    if (disposed) throw new Error('工作台已卸载。');
    if (!bootstrap.capabilities.edit || !/\.(docx|xlsx)$/i.test(fileName)) return;
    const previous = mounts.get(documentId);
    previous?.controller.abort(); previous?.queue?.dispose(); mounts.delete(documentId);
    const controller = new AbortController(), generation = crypto.randomUUID();
    const attachment = await json<Attachment>('/api/easyview/v1/draft-attach', { method: 'POST',
      body: JSON.stringify({ documentId, workbenchId, generation }), signal: controller.signal });
    let recovery: Uint8Array | null = null;
    if (attachment.record && attachment.record.savedEditorRevision !== attachment.record.editorRevision && !attachment.conflict) {
      const response = await fetch(attachment.contentUrl, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('无法读取已确认草稿，已停止打开以保护恢复内容。');
      recovery = new Uint8Array(await response.arrayBuffer());
    }
    mounts.set(documentId, { generation, attachment, recovery, controller });
    if (attachment.conflict) show('conflict', '原件与恢复草稿的基线不同，当前原件只读。', attachment.contentUrl);
    else show('ready', recovery ? '正在恢复已确认草稿…' : (bootstrap.capabilities.save ? '编辑将保存恢复草稿；点击保存可写回原件。' : '编辑将保存恢复草稿；原件保存暂未启用。'));
  }
  function register(editor: DocumentEditorLifecycle): () => void {
    const documentId = editor.snapshot().documentId, mount = mounts.get(documentId);
    if (!mount || mount.attachment.conflict) return () => {};
    const { attachment, controller } = mount;
    mount.editor = editor;
    let checkpointRevision = attachment.record?.checkpointRevision ?? 0;
    const requests = new WeakMap<DraftSnapshot, { requestId: string; expectedCheckpointRevision: number }>();
    mount.ready = (async () => {
      if (mount.recovery && attachment.record) {
        if (editor.snapshot().editorRevision !== 0) throw new Error('恢复前发生新输入，已保留原件与恢复草稿，请重新打开。');
        await editor.restore({ schema: 1, documentId, format: attachment.format, sourceDiskHash: attachment.diskHash,
          editorRevision: attachment.record.editorRevision, bytes: mount.recovery }, controller.signal);
        controller.signal.throwIfAborted(); mount.recovery = null;
        show('restored', '已恢复上次确认的草稿；原件未保存。');
      }
      controller.signal.throwIfAborted();
      mount.persist = async (snapshot, signal) => {
        let metadata = requests.get(snapshot);
        if (!metadata) { metadata = { requestId: crypto.randomUUID(), expectedCheckpointRevision: checkpointRevision }; requests.set(snapshot, metadata); }
        const record = await json<{ checkpointRevision: number }>(endpoint('checkpoint', documentId, mount), {
          method: 'POST', signal, headers: { 'content-type': 'application/octet-stream', 'x-easyview-draft': JSON.stringify({
            ...metadata, editorRevision: snapshot.editorRevision, sourceDiskHash: snapshot.sourceDiskHash, format: snapshot.format }) },
          body: new Uint8Array(snapshot.bytes).buffer });
        checkpointRevision = record.checkpointRevision; return record;
      };
      mount.queue = new EditorCheckpointQueue(editor, mount.persist, { ...bootstrap.checkpointPolicy, status(value) {
        if (controller.signal.aborted) return;
        if (value.state === 'pending') show('pending', '恢复草稿同步中；原件未保存。');
        else if (value.state === 'confirmed') show('confirmed', `恢复草稿已确认（版本 ${value.checkpointRevision}）；原件未保存。`);
        else show('failed', `恢复草稿同步失败：${value.message}。请保持当前编辑器打开。`);
      } });
    })();
    // Keep a rejection handler even when disposal interrupts asynchronous recovery.
    void mount.ready.catch(error => { if (!controller.signal.aborted) show('failed', String(error)); });
    return () => { controller.abort(); mount.queue?.dispose(); if (mounts.get(documentId) === mount) mounts.delete(documentId); };
  }
  async function flush() {
    for (const mount of mounts.values()) { await mount.ready; await mount.queue?.flush(); }
  }
  async function save(snapshot: DraftSnapshot): Promise<PreviewWriteResult> {
    const mount = mounts.get(snapshot.documentId);
    if (!bootstrap.capabilities.save || !mount?.editor) throw new Error('原件保存不可用。');
    await mount.ready;
    if (!mount.pendingSave) {
      await mount.queue?.flush();
      const confirmed = mount.queue?.confirmed();
      const candidate = confirmed?.editorRevision === snapshot.editorRevision ? confirmed : snapshot;
      if (!confirmed) await mount.persist?.(candidate, mount.controller.signal);
      if (mount.editor.snapshot().editorRevision !== candidate.editorRevision) throw new Error('保存前出现了新输入，请重试。');
      mount.pendingSave = { snapshot: candidate, requestId: crypto.randomUUID() };
    }
    const pending = mount.pendingSave;
    const lease = await mount.editor.acquireCommitLease(mount.editor.snapshot().editorRevision, mount.controller.signal);
    try {
      const result = await json<PreviewWriteResult>(endpoint('save', snapshot.documentId, mount), { method: 'POST', signal: mount.controller.signal,
        headers: { 'content-type': 'application/octet-stream', 'x-easyview-save': JSON.stringify({ requestId: pending.requestId,
          format: pending.snapshot.format, sourceDiskHash: pending.snapshot.sourceDiskHash, editorRevision: pending.snapshot.editorRevision }) },
        body: new Uint8Array(pending.snapshot.bytes).buffer });
      mount.attachment.diskHash = result.diskHash!; mount.queue?.rebaseSaved(result.diskHash!); mount.pendingSave = undefined;
      show('saved', '原件已保存并核对文件哈希；恢复草稿已保留。');
      return result;
    } finally { lease.release(); }
  }
  async function readyMount(documentId: string): Promise<Mount & { editor: DocumentEditorLifecycle }> {
    const deadline = Date.now() + 30_000;
    while (!mounts.get(documentId)?.editor) {
      if (disposed) throw new Error('工作台已卸载。');
      if (Date.now() >= deadline) throw new Error('编辑器尚未就绪，请等待文档加载后重试。');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const mount = mounts.get(documentId)!;
    await mount.ready;
    if (!mount.editor || mount.controller.signal.aborted) throw new Error('文档挂载已失效。');
    return Object.assign(mount, { editor: mount.editor });
  }
  async function saveCurrent(documentId: string): Promise<void> {
    // An inactive binary tab first remounts its actual Viewer; never save an
    // opened editor's bytes through a hidden background-write substitute.
    const mount = await readyMount(documentId);
    const snapshot = await mount.editor!.capture(mount.controller.signal);
    const result = await save(snapshot);
    mount.editor!.acknowledgeSaved(result.savedEditorRevision ?? snapshot.editorRevision, result.diskHash!);
  }
  function dispose() {
    if (disposed) return; disposed = true;
    for (const mount of mounts.values()) { mount.controller.abort(); mount.queue?.dispose(); }
    mounts.clear(); status.remove();
  }
  return { prepare, register, flush, dispose, show, save, saveCurrent,
    async ready(documentId: string): Promise<void> { await readyMount(documentId); },
    context: (id: string) => { const mount = mounts.get(id); return mount ? { generation: mount.generation } : {}; },
    async withCleanLease<T>(documentId: string, action: (revision: number) => Promise<T>): Promise<T> {
      const mount = await readyMount(documentId);
      if (mount.pendingSave || mount.attachment.conflict) throw new Error('请先激活文档并等待当前保存结束。');
      await mount.ready; await mount.queue?.flush();
      const editor = mount.editor, state = editor.snapshot();
      if (state.dirty) throw new Error('请先保存或明确丢弃当前修改，再撤销文件保存。');
      const lease = await editor.acquireCommitLease(state.editorRevision, mount.controller.signal);
      try { return await action(lease.revision); } finally { lease.release(); }
    },
    baseline: (id: string) => mounts.get(id)?.attachment.diskHash ?? '',
    canEdit: (id: string) => Boolean(mounts.has(id) && !mounts.get(id)?.attachment.conflict) };
}
