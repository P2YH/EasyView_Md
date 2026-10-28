/** Authorized file history and guarded undo share the journal used by Save. */
import { contentHash, DocumentError, type DocumentProvider } from './documents.ts';
import type { DraftStore } from './draft-store.ts';
import type { OperationJournal } from './operation-journal.ts';
import type { EasyViewHostContext } from '../shared/contracts.ts';
import { readBounded } from './draft-routes.ts';

type Route = Parameters<EasyViewHostContext['connection']['fetch']['register']>[0];
export function installFileHistoryRoutes(options: {
  register(route: Route): void;
  documents: DocumentProvider; store: DraftStore; journal: OperationJournal;
  wrap(action: Route['fetch']): Route['fetch'];
  binding(request: Request): Promise<{ key: string; generation: string; fileIdentity: string }>;
  activeBindings(fileIdentity: string): number;
}) {
  const { documents, store, journal, register, wrap } = options;
  const target = (request: Request) => documents.reference(new URL(request.url).searchParams.get('documentId') ?? '');
  register({ path: '/api/easyview/v1/operations', methods: ['GET'], requestBody: 'buffered', fetch: wrap(async request => {
    await options.binding(request);
    const reference = target(request), records = journal.list().filter(record => record.target.fileIdentity === reference.fileIdentity);
    return Response.json({ ok: true, value: records.slice(-100).reverse().map(record => ({
      operationId: record.operationId, kind: record.kind, state: record.state, createdAt: record.createdAt,
      canUndo: record.kind !== 'create' && record.state === 'committed' && !record.noOp
        && !records.some(undo => undo.undoOf === record.operationId),
      undoOf: record.undoOf,
    })) }, { headers: { 'cache-control': 'no-store' } });
  }) });
  register({ path: '/api/easyview/v1/undo', methods: ['POST'], requestBody: 'streaming', fetch: wrap(async request => {
    const bound = await options.binding(request), reference = target(request);
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(request, 2048)));
    if (!body || !['requestId', 'operationId'].every(key => typeof body[key] === 'string' && /^[a-f0-9-]{36}$/.test(body[key]))
      || !Number.isSafeInteger(body.editorRevision) || body.editorRevision < 0) throw new DocumentError('INVALID_ARGUMENT', '无效的文件撤销请求。');
    const original = journal.get(body.operationId);
    if (!original || original.target.fileIdentity !== reference.fileIdentity) throw new DocumentError('PERMISSION_DENIED', '操作不属于当前授权文档。');
    const requestHash = contentHash(Buffer.from(JSON.stringify({ operationId: body.operationId, fileIdentity: reference.fileIdentity })));
    const receipt = journal.byRequest(body.requestId);
    if (receipt && (receipt.undoOf !== body.operationId || receipt.payloadHash !== requestHash)) throw new DocumentError('CONFLICT', '撤销请求身份冲突。');
    const admit = () => {
      store.assertGeneration(bound.key, bound.generation);
      store.assertFileClean(reference.fileIdentity);
      const draft = store.load(bound.key);
      // Clean Office remounts start at revision zero; the old saved recovery
      // record belongs to its previous generation and is not a live revision.
      if ((draft?.generation === bound.generation ? draft.editorRevision : 0) !== body.editorRevision) throw new DocumentError('CONFLICT', '文档版本已变化，撤销未执行。');
      if (options.activeBindings(reference.fileIdentity) !== 1) throw new DocumentError('CONFLICT', '请先关闭此文件的其它工作台入口，再撤销文件保存。');
    };
    const operation = await journal.undo(body.operationId, body.requestId, { requestHash, admit, signal: request.signal });
    if (operation.state !== 'committed') throw new DocumentError('CONFLICT', `撤销状态：${operation.state}，请保留当前内容并核对操作记录。`);
    store.retireCleanFile(reference.fileIdentity, operation.outputHash);
    documents.saved(new URL(request.url).searchParams.get('documentId')!, operation.outputHash);
    return Response.json({ ok: true, value: { operationId: operation.operationId, undoOf: body.operationId,
      state: operation.state, diskHash: operation.outputHash, reloadRequired: true } }, { headers: { 'cache-control': 'no-store' } });
  }) });
}
