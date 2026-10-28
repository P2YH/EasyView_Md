/** Authenticated binary checkpoint transfer; UI messages never carry Office bytes. */
import { contentHash, DocumentError, type DocumentProvider } from './documents.ts';
import { DraftStore } from './draft-store.ts';
import type { EasyViewHostContext } from '../shared/contracts.ts';
import { applyTextPatches, createCanonicalDocument, hashContent, validatePatches } from '@easyview/editor-sync';
import type { OperationJournal } from './operation-journal.ts';
import { installFileHistoryRoutes } from './file-history.ts';
import type { AiAddress } from '../shared/ai.ts';

type Route = Parameters<EasyViewHostContext['connection']['fetch']['register']>[0];
export function installDraftRoutes(options: {
  register(route: Route): void;
  documents: DocumentProvider;
  store: DraftStore;
  journal?: OperationJournal | null;
  maxBytes: number;
  maxPending: number;
  isDisposed(): boolean;
  logError?(error: unknown): void;
}) {
  const { register, documents, store, maxBytes, maxPending } = options;
  const bindings = new Map<string, { key: string; generation: string; fileIdentity: string }>();
  let pending = 0;
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new DocumentError('INVALID_ARGUMENT', '无效的工作台或文档身份。');
    return value;
  };
  const number = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DocumentError('INVALID_ARGUMENT', '无效的草稿版本。');
    return value;
  };
  const wrap = (action: Route['fetch']): Route['fetch'] => async request => {
    try { if (options.isDisposed()) throw new Error('Plugin is unloading'); return await action(request); }
    catch (error) {
      if (!(error instanceof DocumentError)) options.logError?.(error);
      return Response.json({ ok: false, code: error instanceof DocumentError ? error.code : 'UNKNOWN',
        message: error instanceof DocumentError ? error.message : '恢复草稿存储失败，当前内容仍保留，请勿关闭编辑器。' },
      { status: error instanceof DocumentError && error.code === 'PERMISSION_DENIED' ? 403 : 409, headers: { 'cache-control': 'no-store' } });
    }
  };
  const binding = async (request: Request) => {
    const params = new URL(request.url).searchParams;
    const documentId = id(params.get('documentId')), workbenchId = id(params.get('workbenchId')), generation = id(params.get('generation'));
    const identity = await documents.draftIdentity(documentId, request.signal);
    if (!identity.format) throw new DocumentError('INVALID_ARGUMENT', '不支持此草稿格式。');
    const bound = bindings.get(`${documentId}:${workbenchId}`);
    if (!bound || bound.generation !== generation) throw new DocumentError('CONFLICT', '草稿挂载身份已失效，请重新进入文档。');
    return { ...bound, identity: { ...identity, format: identity.format } };
  };
  register({ path: '/api/easyview/v1/draft-attach', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await readBounded(request, 2048)));
    if (!parsed || typeof parsed !== 'object') throw new DocumentError('INVALID_ARGUMENT', '无效的挂载请求。');
    const documentId = id(Reflect.get(parsed, 'documentId')), workbenchId = id(Reflect.get(parsed, 'workbenchId')), generation = id(Reflect.get(parsed, 'generation'));
    const identity = await documents.draftIdentity(documentId, request.signal);
    if (!identity.format) throw new DocumentError('INVALID_ARGUMENT', '此格式尚未接通可恢复编辑。');
    const key = contentHash(Buffer.from(`${workbenchId}\0${identity.fileIdentity}`));
    if (bindings.size >= 512 && !bindings.has(`${documentId}:${workbenchId}`)) throw new DocumentError('CONFLICT', '草稿会话已达到上限，请关闭部分标签。');
    store.begin(key, generation, identity.fileIdentity);
    const record = store.load(key);
    bindings.set(`${documentId}:${workbenchId}`, { key, generation, fileIdentity: identity.fileIdentity });
    const content = new URL('/api/easyview/v1/draft-content', request.url);
    content.searchParams.set('documentId', documentId); content.searchParams.set('workbenchId', workbenchId); content.searchParams.set('generation', generation);
    return Response.json({ ok: true, value: { format: identity.format, diskHash: identity.diskHash,
      record, conflict: Boolean(record && record.sourceDiskHash !== identity.diskHash), contentUrl: content.pathname + content.search } }, { headers: { 'cache-control': 'no-store' } });
  }) });
  register({ path: '/api/easyview/v1/draft-state', methods: ['GET'], requestBody: 'buffered', fetch: wrap(async request => {
    const params = new URL(request.url).searchParams, documentId = id(params.get('documentId')), workbenchId = id(params.get('workbenchId'));
    const identity = await documents.draftIdentity(documentId, request.signal);
    const bound = bindings.get(`${documentId}:${workbenchId}`);
    const record = bound ? store.load(bound.key) : null;
    return Response.json({ ok: true, value: { generation: bound?.generation, format: identity.format,
      dirty: Boolean(record && record.savedEditorRevision !== record.editorRevision), checkpointRevision: record?.checkpointRevision ?? 0 } }, { headers: { 'cache-control': 'no-store' } });
  }) });
  register({ path: '/api/easyview/v1/discard', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    const bound = await binding(request);
    const metadata = JSON.parse(new TextDecoder().decode(await readBounded(request, 2048)));
    await store.discard(bound.key, bound.generation, number(metadata.expectedCheckpointRevision), id(metadata.requestId));
    return Response.json({ ok: true, value: true }, { headers: { 'cache-control': 'no-store' } });
  }) });
  register({ path: '/api/easyview/v1/draft-content', methods: ['GET'], requestBody: 'buffered', fetch: wrap(async request => {
    const bound = await binding(request); const record = store.load(bound.key);
    if (!record) throw new DocumentError('NOT_FOUND', '没有已确认的恢复草稿。');
    return new Response(new Uint8Array(await store.bytes(record)), { headers: { 'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="recovered.${record.format}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
  }) });
  register({ path: '/api/easyview/v1/checkpoint', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    if (pending >= maxPending) throw new DocumentError('CONFLICT', '草稿同步繁忙，请稍后重试。');
    pending++;
    try {
      const bound = await binding(request);
      if (!['docx', 'xlsx'].includes(bound.identity.format)) throw new DocumentError('INVALID_ARGUMENT', '文本编辑必须使用持久化补丁协议。');
      const header = request.headers.get('x-easyview-draft');
      if (!header || header.length > 2048) throw new DocumentError('INVALID_ARGUMENT', '无效的草稿元数据。');
      const metadata: unknown = JSON.parse(header);
      if (!metadata || typeof metadata !== 'object') throw new DocumentError('INVALID_ARGUMENT', '无效的草稿元数据。');
      const requestId = id(Reflect.get(metadata, 'requestId'));
      const editorRevision = number(Reflect.get(metadata, 'editorRevision'));
      const expectedCheckpointRevision = number(Reflect.get(metadata, 'expectedCheckpointRevision'));
      if (Reflect.get(metadata, 'sourceDiskHash') !== bound.identity.diskHash || Reflect.get(metadata, 'format') !== bound.identity.format) {
        throw new DocumentError('CONFLICT', '草稿与文档基线或格式不匹配。');
      }
      const bytes = await readBounded(request, maxBytes);
      const previous = store.load(bound.key);
      if (previous && previous.sourceDiskHash !== bound.identity.diskHash) throw new DocumentError('CONFLICT', '原件与恢复草稿的基线不同，请先保留并处理冲突。');
      if (options.isDisposed()) throw new Error('Plugin is unloading');
      const record = await store.checkpoint({ key: bound.key, generation: bound.generation, requestId,
        editorRevision, expectedCheckpointRevision, format: bound.identity.format!, sourceDiskHash: bound.identity.diskHash, bytes });
      return Response.json({ ok: true, value: record }, { headers: { 'cache-control': 'no-store' } });
    } finally { pending--; }
  }) });
  register({ path: '/api/easyview/v1/text-snapshot', methods: ['GET'], requestBody: 'buffered', fetch: wrap(async request => {
    const bound = await binding(request);
    if (!['markdown', 'text'].includes(bound.identity.format)) throw new DocumentError('INVALID_ARGUMENT', '不是文本编辑会话。');
    const record = store.adoptText(bound.key, bound.generation);
    if (record && record.sourceDiskHash !== bound.identity.diskHash) throw new DocumentError('CONFLICT', '恢复草稿与当前原件不同，已保留两者。');
    const bytes = record ? await store.bytes(record) : await documents.read(new URL(request.url).searchParams.get('documentId')!, request.signal);
    const content = createCanonicalDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).content;
    return Response.json({ ok: true, value: { content, contentHash: hashContent(content), revision: record?.editorRevision ?? 0,
      checkpointRevision: record?.checkpointRevision ?? 0, savedEditorRevision: record?.savedEditorRevision ?? 0,
      dirty: Boolean(record && record.savedEditorRevision !== record.editorRevision) } }, { headers: { 'cache-control': 'no-store' } });
  }) });
  register({ path: '/api/easyview/v1/text-edits', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    if (pending >= maxPending) throw new DocumentError('CONFLICT', '草稿同步繁忙，请稍后重试。');
    pending++;
    try {
      const bound = await binding(request);
      if (!['markdown', 'text'].includes(bound.identity.format)) throw new DocumentError('INVALID_ARGUMENT', '不是文本编辑会话。');
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(request, Math.min(maxBytes * 6 + 4096, 16 * 1024 * 1024))));
      if (!parsed || typeof parsed !== 'object') throw new DocumentError('INVALID_ARGUMENT', '无效的文本编辑请求。');
      const clientEditId = Reflect.get(parsed, 'clientEditId'), resultHash = Reflect.get(parsed, 'resultHash');
      const aiOperationId = Reflect.get(parsed, 'aiOperationId');
      if (aiOperationId !== undefined && (typeof aiOperationId !== 'string' || !/^[a-f0-9]{64}$/.test(aiOperationId))) throw new DocumentError('INVALID_ARGUMENT', '无效的 AI 操作身份。');
      const baseRevision = number(Reflect.get(parsed, 'baseRevision'));
      if (typeof clientEditId !== 'string' || !clientEditId || clientEditId.length > 200 || typeof resultHash !== 'string' || !/^[a-f0-9]{16}$/.test(resultHash)) throw new DocumentError('INVALID_ARGUMENT', '无效的文本同步身份。');
      const edits = Reflect.get(parsed, 'edits');
      if (!Array.isArray(edits) || edits.length > 1024 || edits.some(edit => !edit || typeof edit !== 'object'
        || !Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to) || typeof edit.insert !== 'string')) throw new DocumentError('INVALID_ARGUMENT', '无效的文本补丁。');
      const requestId = contentHash(Buffer.from(`${bound.key}\0${bound.generation}\0${clientEditId}`));
      const requestHash = contentHash(Buffer.from(JSON.stringify({ key: bound.key, generation: bound.generation, clientEditId, baseRevision, edits, resultHash, aiOperationId })));
      let record = await store.receipt(requestId, requestHash);
      if (!record) {
        const previous = store.load(bound.key);
        if ((previous?.editorRevision ?? 0) !== baseRevision || (previous && previous.sourceDiskHash !== bound.identity.diskHash)) throw new DocumentError('CONFLICT', '文本版本冲突，当前编辑内容与恢复草稿均已保留。');
        const bytes = previous ? await store.bytes(previous) : await documents.read(new URL(request.url).searchParams.get('documentId')!, request.signal);
        const content = createCanonicalDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).content;
        const next = applyTextPatches(content, validatePatches(edits, content.length));
        const output = new TextEncoder().encode(next);
        if (output.byteLength > maxBytes || hashContent(next) !== resultHash) throw new DocumentError('CONFLICT', '文本补丁结果不匹配或超出容量限制。');
        record = await store.checkpoint({ key: bound.key, generation: bound.generation, requestId, requestHash, editorRevision: baseRevision + 1,
          expectedCheckpointRevision: previous?.checkpointRevision ?? 0, format: bound.identity.format!, sourceDiskHash: bound.identity.diskHash, bytes: output, aiOperationId });
      }
      return Response.json({ ok: true, value: { clientEditId, revision: record.editorRevision, resultHash, checkpointRevision: record.checkpointRevision } }, { headers: { 'cache-control': 'no-store' } });
    } finally { pending--; }
  }) });
  if (options.journal) register({ path: '/api/easyview/v1/save', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    if (pending >= maxPending) throw new DocumentError('CONFLICT', '文件同步繁忙，请稍后重试。');
    pending++;
    try {
    const journal = options.journal!;
    const bound = await binding(request);
    const header = request.headers.get('x-easyview-save');
    if (!header || header.length > 2048) throw new DocumentError('INVALID_ARGUMENT', '无效的保存元数据。');
    const metadata = JSON.parse(header);
    const requestId = id(metadata.requestId), editorRevision = number(metadata.editorRevision), baseHash = metadata.sourceDiskHash;
    if (typeof baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(baseHash) || metadata.format !== bound.identity.format) throw new DocumentError('INVALID_ARGUMENT', '无效的保存基线或格式。');
    const bytes = await readBounded(request, maxBytes);
    const target = documents.reference(new URL(request.url).searchParams.get('documentId')!);
    const requestHash = contentHash(Buffer.from(JSON.stringify({ target, generation: bound.generation, editorRevision, baseHash, format: metadata.format, bytes: contentHash(bytes) })));
    const receipt = journal.byRequest(requestId);
    if (!receipt) {
      const draft = store.load(bound.key);
      if (!draft || draft.generation !== bound.generation || draft.editorRevision !== editorRevision || draft.sourceDiskHash !== baseHash || draft.blobHash !== contentHash(bytes)
        || bound.identity.diskHash !== baseHash) throw new DocumentError('CONFLICT', '请先确认最新恢复草稿；原件保存尚未执行。');
    }
    let output = bytes;
    if (['markdown', 'text'].includes(bound.identity.format)) {
      const original = receipt ? await store.readBlob(receipt.backup) : await documents.readReference(target);
      output = new TextEncoder().encode(createCanonicalDocument(new TextDecoder('utf-8', { fatal: true }).decode(original)).toRawContent(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    }
    const operation = await journal.save({ requestId, requestHash, target, baseHash, bytes: output, editorRevision, draft: { key: bound.key, generation: bound.generation } });
    if (operation.state !== 'committed') return Response.json({ ok: false, code: 'CONFLICT', message: `文件提交状态：${operation.state}，请保留当前内容并查看恢复记录。`, operation }, { status: 409 });
    documents.saved(new URL(request.url).searchParams.get('documentId')!, operation.outputHash);
    return Response.json({ ok: true, value: { size: output.byteLength, mtimeMs: 0, diskHash: operation.outputHash,
      savedEditorRevision: operation.editorRevision, operationId: operation.operationId, canUndo: !operation.noOp } }, { headers: { 'cache-control': 'no-store' } });
    } finally { pending--; }
  }) });
  if (options.journal) installFileHistoryRoutes({ register, documents, store, journal: options.journal, wrap,
    binding, activeBindings: fileIdentity => [...bindings.values()].filter(value => value.fileIdentity === fileIdentity).length });
  function clean(address: AiAddress, expectedRevision?: number) {
    const documentId = id(address.documentId), workbenchId = id(address.workbenchId), generation = id(address.generation);
    const bound = bindings.get(`${documentId}:${workbenchId}`), target = documents.reference(documentId);
    if (!bound || bound.generation !== generation || target.workspaceId !== address.workspaceId) throw new DocumentError('CONFLICT', '文档挂载已失效，请重新打开。');
    store.assertGeneration(bound.key, generation); store.assertFileClean(target.fileIdentity);
    if ([...bindings.values()].filter(value => value.fileIdentity === target.fileIdentity).length !== 1) throw new DocumentError('CONFLICT', '请先关闭此文件的其它工作台入口。');
    const record = store.load(bound.key), editorRevision = record?.generation === generation ? record.editorRevision : 0;
    if (expectedRevision !== undefined && expectedRevision !== editorRevision) throw new DocumentError('CONFLICT', '编辑版本已变化，请重新生成提案。');
    return { ...bound, target, editorRevision };
  }
  return { clean, release(documentId: string) { for (const key of bindings.keys()) if (key.startsWith(`${documentId}:`)) bindings.delete(key); } };
}

export async function readBounded(request: Request, maximum: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel('Size limit exceeded'); throw new DocumentError('INVALID_ARGUMENT', '草稿超出配置的容量上限。'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
