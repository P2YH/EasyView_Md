/** Durable original-UI XLSX proposals. Old pending decisions never survive a Host generation. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { inspectXlsxBytes, planXlsxBytes, type XlsxDiff } from '@easyview/node-runtime/xlsx-edit';
import { contentHash, DocumentError, type DocumentProvider, type FileReference } from './documents.ts';
import type { DraftStore } from './draft-store.ts';
import type { OperationJournal } from './operation-journal.ts';
import type { installDraftRoutes } from './draft-routes.ts';
import type { AiAddress, VisibleOfficeEdit } from '../shared/ai.ts';

type State = 'pending_decision' | 'committing' | 'committed' | 'rejected' | 'cancelled' | 'expired' | 'not_applied' | 'conflict' | 'unknown' | 'no_change';
interface Proposal {
  schema: 1; id: string; toolId: string; inputHash: string; owner: string; conversationKey: string; requestId: string;
  address: AiAddress; target: FileReference; baseHash: string; editorRevision: number;
  candidate: string; fileName: string; diff: XlsxDiff; state: State; operationId?: string; error?: string;
}
export class XlsxProposals {
  private readonly database: DatabaseSync;
  private readonly owner = randomUUID();
  private readonly waiting = new Map<string, { signal: AbortSignal; complete(): void }>();
  private readonly decisions = new Map<string, Promise<Proposal>>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(directory: string, private readonly drafts: DraftStore, private readonly journal: OperationJournal,
    private readonly documents: DocumentProvider, private readonly mounts: Pick<ReturnType<typeof installDraftRoutes>, 'clean'>) {
    this.database = new DatabaseSync(resolve(directory, 'xlsx-proposals.sqlite'));
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, toolId TEXT UNIQUE NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (requestId TEXT PRIMARY KEY, payloadHash TEXT NOT NULL, proposalId TEXT NOT NULL);`);
    for (const row of this.database.prepare('SELECT record FROM proposals').all()) {
      const proposal = decode(row.record);
      if (proposal.state === 'pending_decision' || proposal.state === 'committing' || proposal.state === 'unknown') {
        const operation = this.journal.byRequest(proposal.id);
        proposal.state = operation?.state === 'committed' ? 'committed' : operation?.state === 'not_applied' ? 'not_applied'
          : operation?.state === 'conflict' ? 'conflict' : operation ? 'unknown' : 'expired';
        proposal.operationId = operation?.operationId;
        if (proposal.state === 'expired') proposal.error = '执行已中断，请重新生成。';
        this.write(proposal);
        if (proposal.state === 'committed') this.drafts.retireCleanFile(proposal.target.fileIdentity, operation!.outputHash);
      }
    }
  }
  async inspect(address: AiAddress, signal: AbortSignal) {
    signal.throwIfAborted();
    const documentId = address.documentId;
    if (!documentId || (await this.documents.draftIdentity(documentId, signal)).format !== 'xlsx') throw new DocumentError('INVALID_ARGUMENT', '请先打开 XLSX 文档。');
    const bytes = await this.documents.read(documentId, signal);
    return inspectXlsxBytes(bytes, this.documents.reference(documentId).relativePath.split('/').at(-1)!);
  }
  assertClean(address: AiAddress) { return this.mounts.clean(address); }
  async propose(input: { address: AiAddress; conversationKey: string; requestId: string; toolId: string; args: unknown; signal: AbortSignal }) {
    const { address, signal } = input;
    if (this.closed) throw new DocumentError('CONFLICT', '插件正在卸载。');
    signal.throwIfAborted();
    if (!input.args || typeof input.args !== 'object' || typeof Reflect.get(input.args, 'fingerprint') !== 'string') throw new DocumentError('INVALID_ARGUMENT', '无效的 XLSX 修改参数。');
    const inputHash = contentHash(Buffer.from(JSON.stringify(input.args)));
    const previous = this.database.prepare('SELECT record FROM proposals WHERE toolId=?').get(input.toolId);
    if (previous) {
      const proposal = decode(previous.record);
      if (proposal.inputHash !== inputHash || proposal.conversationKey !== input.conversationKey) throw new DocumentError('CONFLICT', '工具操作身份冲突。');
      if (proposal.state === 'pending_decision') throw new DocumentError('CONFLICT', '此提案仍在等待原用户决定，不重复创建等待任务。');
      return this.result(proposal);
    }
    if (Number(this.database.prepare('SELECT count(*) AS count FROM proposals').get()?.count) >= 2048) throw new DocumentError('CONFLICT', '提案记录已达到上限。');
    const current = this.mounts.clean(address);
    if ((await this.documents.draftIdentity(address.documentId!, signal)).format !== 'xlsx') throw new DocumentError('INVALID_ARGUMENT', '此工具仅适用于 XLSX。');
    const original = await this.documents.read(address.documentId!, signal), baseHash = contentHash(original);
    const planned = await planXlsxBytes(original, current.target.relativePath, Reflect.get(input.args, 'fingerprint'), Reflect.get(input.args, 'ops'));
    signal.throwIfAborted(); this.mounts.clean(address, current.editorRevision);
    const noChange = !planned.diff.total && !planned.diff.structural.length;
    const candidate = await this.drafts.writeBlob(noChange ? original : planned.buffer);
    signal.throwIfAborted(); this.mounts.clean(address, current.editorRevision);
    const proposal: Proposal = { schema: 1, id: randomUUID(), toolId: input.toolId, inputHash, owner: this.owner,
      conversationKey: input.conversationKey, requestId: input.requestId, address: { ...address }, target: current.target,
      baseHash, editorRevision: current.editorRevision, candidate, fileName: current.target.relativePath.split('/').at(-1)!, diff: planned.diff, state: noChange ? 'no_change' : 'pending_decision' };
    this.write(proposal); // durable before any original proposal card is visible
    if (noChange) return this.result(proposal);
    await new Promise<void>(resolve => {
      const cancelled = () => {
        const current = this.get(proposal.id);
        if (current.state === 'pending_decision') { current.state = 'cancelled'; this.write(current); complete(); }
        // Once committing, journal signal/admission decides whether prepared has won.
      };
      const complete = () => { signal.removeEventListener('abort', cancelled); this.waiting.delete(proposal.id); resolve(); };
      this.waiting.set(proposal.id, { signal, complete }); signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
    return this.result(this.get(proposal.id));
  }
  async decide(conversationKey: string, input: { proposalId: string; decisionId: string; accepted: boolean; editorRevision: number }) {
    if (this.closed || !input || typeof input.accepted !== 'boolean' || !/^[a-f0-9-]{36}$/.test(input.decisionId)
      || !/^[a-f0-9-]{36}$/.test(input.proposalId) || !Number.isSafeInteger(input.editorRevision) || input.editorRevision < 0) throw new DocumentError('INVALID_ARGUMENT', '无效的提案决定。');
    const proposal = this.get(input.proposalId);
    if (proposal.conversationKey !== conversationKey) throw new DocumentError('PERMISSION_DENIED', '提案不属于当前文档会话。');
    const hash = contentHash(Buffer.from(JSON.stringify(input)));
    const receipt = this.database.prepare('SELECT payloadHash FROM decisions WHERE requestId=?').get(input.decisionId);
    if (receipt && receipt.payloadHash !== hash) throw new DocumentError('CONFLICT', '同一决定身份对应不同内容。');
    if (!receipt) this.database.prepare('INSERT INTO decisions VALUES (?, ?, ?)').run(input.decisionId, hash, proposal.id);
    const pending = this.decisions.get(proposal.id);
    if (pending) return this.result(await pending);
    if (proposal.state === 'unknown' && proposal.operationId) {
      const operation = await this.journal.reconcileOperation(proposal.operationId);
      proposal.state = operation.state === 'committed' ? 'committed' : operation.state === 'not_applied' ? 'not_applied'
        : operation.state === 'conflict' ? 'conflict' : 'unknown';
      if (proposal.state === 'committed') { this.drafts.retireCleanFile(proposal.target.fileIdentity, operation.outputHash);
        this.documents.saved(proposal.address.documentId!, operation.outputHash); }
      this.write(proposal); return this.result(proposal);
    }
    if (proposal.state !== 'pending_decision') return this.result(proposal);
    if (proposal.owner !== this.owner || !this.waiting.has(proposal.id)) {
      proposal.state = 'expired'; proposal.error = '执行已中断，请重新生成。'; this.write(proposal); return this.result(proposal);
    }
    if (!input.accepted) { proposal.state = 'rejected'; this.write(proposal); this.waiting.get(proposal.id)?.complete(); return this.result(proposal); }
    const task = this.commit(proposal, input.editorRevision); this.decisions.set(proposal.id, task);
    try { return this.result(await task); } finally { this.decisions.delete(proposal.id); this.waiting.get(proposal.id)?.complete(); }
  }
  projection(conversationKey: string, requestId: string): VisibleOfficeEdit[] {
    return this.database.prepare('SELECT record FROM proposals').all().map(row => decode(row.record))
      .filter(proposal => proposal.conversationKey === conversationKey && proposal.requestId === requestId && proposal.state !== 'no_change').map(proposal => {
        const undone = proposal.operationId && this.journal.list().some(operation => operation.undoOf === proposal.operationId && operation.state === 'committed');
        const status = undone ? 'undone' : proposal.state === 'pending_decision' ? 'pending' : proposal.state === 'committing' ? 'applying'
          : proposal.state === 'committed' ? 'applied' : proposal.state === 'rejected' || proposal.state === 'cancelled' ? 'rejected' : 'error';
        return { proposalId: proposal.id, fileName: proposal.fileName, ...proposal.diff, status,
          ...(proposal.operationId && { commitId: proposal.operationId }), ...(proposal.error && { error: proposal.error }) };
      });
  }
  close(): Promise<void> { return this.closing ??= this.shutdown(); }
  private async shutdown() {
    this.closed = true;
    for (const [id, waiter] of this.waiting) {
      const proposal = this.get(id);
      if (proposal.state === 'pending_decision') { proposal.state = 'expired'; proposal.error = '插件已卸载，请重新生成。'; this.write(proposal); waiter.complete(); }
    }
    await Promise.allSettled(this.decisions.values()); this.database.close();
  }
  private async commit(proposal: Proposal, editorRevision: number): Promise<Proposal> {
    proposal.state = 'committing'; this.write(proposal);
    try {
      const waiter = this.waiting.get(proposal.id)!;
      const admit = () => { waiter.signal.throwIfAborted(); this.mounts.clean(proposal.address, proposal.editorRevision);
        if (editorRevision !== proposal.editorRevision) throw new DocumentError('CONFLICT', '编辑版本已变化，请重新生成提案。'); };
      admit();
      const operation = await this.journal.save({ requestId: proposal.id, requestHash: contentHash(Buffer.from(`${proposal.id}\0${proposal.inputHash}`)),
        target: proposal.target, baseHash: proposal.baseHash, bytes: await this.drafts.readBlob(proposal.candidate), editorRevision,
        signal: waiter.signal, admit });
      proposal.operationId = operation.operationId;
      proposal.state = operation.state === 'committed' ? 'committed' : operation.state === 'not_applied' ? 'not_applied' : operation.state === 'conflict' ? 'conflict' : 'unknown';
      if (proposal.state === 'committed') {
        this.drafts.retireCleanFile(proposal.target.fileIdentity, operation.outputHash);
        this.documents.saved(proposal.address.documentId!, operation.outputHash);
      }
    } catch (error) {
      const operation = this.journal.byRequest(proposal.id);
      proposal.operationId = operation?.operationId;
      proposal.state = operation?.state === 'committed' ? 'committed' : operation ? 'unknown' : this.waiting.get(proposal.id)?.signal.aborted ? 'cancelled' : 'conflict';
      proposal.error = error instanceof Error ? error.message : String(error);
    }
    this.write(proposal); return proposal;
  }
  private get(id: string): Proposal {
    const row = this.database.prepare('SELECT record FROM proposals WHERE id=?').get(id);
    if (!row) throw new DocumentError('NOT_FOUND', '提案不存在。'); return decode(row.record);
  }
  private result(proposal: Proposal) { return { proposalId: proposal.id, operationId: proposal.operationId, state: proposal.state,
    terminal: proposal.state !== 'pending_decision' && proposal.state !== 'committing' && proposal.state !== 'unknown',
    ...(proposal.state === 'expired' && { code: 'proposal_expired' }), error: proposal.error, filePath: proposal.target.relativePath }; }
  private write(proposal: Proposal) {
    this.database.prepare('INSERT INTO proposals VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(proposal.id, proposal.toolId, JSON.stringify(proposal));
  }
}
function decode(value: unknown): Proposal {
  const proposal = JSON.parse(String(value));
  if (proposal?.schema !== 1 || typeof proposal.id !== 'string' || !Array.isArray(proposal.diff?.changes)
    || !['pending_decision', 'committing', 'committed', 'rejected', 'cancelled', 'expired', 'not_applied', 'conflict', 'unknown', 'no_change'].includes(proposal.state)) throw new Error('Unsupported XLSX proposal record; evidence preserved');
  return proposal;
}
