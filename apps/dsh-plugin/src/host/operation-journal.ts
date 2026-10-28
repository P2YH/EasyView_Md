/** Durable file commits. Recovery only inspects evidence; it never repeats a write. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { contentHash, DocumentError, type FileReference } from './documents.ts';
import type { DraftStore } from './draft-store.ts';

export type OperationState = 'prepared' | 'committed' | 'not_applied' | 'conflict' | 'unknown';
export interface FileOperation {
  schema: 1; operationId: string; requestId: string; payloadHash: string; owner: string;
  kind: 'save' | 'undo' | 'create'; target: FileReference; baseHash: string; outputHash: string;
  candidate: string; backup: string; editorRevision: number; state: OperationState;
  createdAt: string; noOp: boolean; undoOf?: string; error?: string;
  draft?: { key: string; generation: string };
  draftRebased?: boolean;
}
export interface CommitTargetProvider {
  inspectReference?(target: FileReference): Promise<Uint8Array | null>;
  createReference?(target: FileReference, bytes: Uint8Array): Promise<void>;
  readReference(target: FileReference): Promise<Uint8Array>;
  replaceReference(target: FileReference, bytes: Uint8Array, expectedHash: string): Promise<void>;
}
export interface CommitInput {
  signal?: AbortSignal;
  /** Rechecked under the file lock, immediately before durable prepared. */
  admit?: () => void;
  requestId: string; target: FileReference; baseHash: string; bytes: Uint8Array; editorRevision: number;
  draft?: { key: string; generation: string };
  requestHash?: string;
}
type Fault = 'F01' | 'F02' | 'F03' | 'F04';

export class OperationJournal {
  private readonly metadata: DatabaseSync;
  private readonly owner = randomUUID();
  private readonly locks = new Map<string, Promise<unknown>>();
  private closing = false;
  private pending = 0;
  constructor(directory: string, private readonly blobs: DraftStore, private readonly targets: CommitTargetProvider,
    private readonly fault?: (point: Fault, operation: FileOperation) => Promise<void>) {
    this.metadata = new DatabaseSync(resolve(directory, 'operations.sqlite'));
    try {
      this.metadata.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;');
      const version = this.metadata.prepare('PRAGMA user_version').get()?.user_version;
      if (typeof version !== 'number' || version > 1) throw new Error('Unsupported operation journal schema');
      this.metadata.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS operations (operationId TEXT PRIMARY KEY, requestId TEXT UNIQUE NOT NULL, undoOf TEXT UNIQUE, record TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
    } catch (error) { this.metadata.close(); throw error; }
  }

  get(operationId: string): FileOperation | null {
    const row = this.metadata.prepare('SELECT record FROM operations WHERE operationId=?').get(operationId);
    return row ? decode(row.record) : null;
  }
  byRequest(requestId: string): FileOperation | null {
    const row = this.metadata.prepare('SELECT record FROM operations WHERE requestId=?').get(requestId);
    return row ? decode(row.record) : null;
  }
  list(): FileOperation[] {
    return this.metadata.prepare('SELECT record FROM operations ORDER BY rowid').all().map(row => decode(row.record));
  }
  reconcileOperation(operationId: string): Promise<FileOperation> {
    const record = this.get(operationId);
    if (!record) return Promise.reject(new DocumentError('NOT_FOUND', '文件操作不存在。'));
    return this.serial(record.target.fileIdentity, () => this.settled(record));
  }
  async recover(): Promise<void> {
    for (const record of this.list()) {
      if (record.state === 'prepared' || record.state === 'unknown') await this.serial(record.target.fileIdentity, () => this.reconcile(record));
      else if (record.state === 'committed') this.rebaseDraft(record);
    }
  }
  save(input: CommitInput): Promise<FileOperation> {
    const copy = { ...input, target: { ...input.target }, bytes: input.bytes.slice(), draft: input.draft && { ...input.draft } };
    return this.serial(copy.target.fileIdentity, () => this.commit(copy));
  }
  create(input: Omit<CommitInput, 'baseHash' | 'editorRevision' | 'draft'>): Promise<FileOperation> {
    const copy = { ...input, target: { ...input.target }, bytes: input.bytes.slice(), baseHash: contentHash(new Uint8Array()), editorRevision: 0 };
    return this.serial(copy.target.fileIdentity, () => this.commit(copy, undefined, true));
  }
  undo(operationId: string, requestId: string, options: Pick<CommitInput, 'signal' | 'admit' | 'requestHash'> = {}): Promise<FileOperation> {
    const original = this.get(operationId);
    if (!original || original.kind === 'create' || original.state !== 'committed' || original.noOp) return Promise.reject(new DocumentError('CONFLICT', '此操作不可撤销。'));
    return this.serial(original.target.fileIdentity, async () => {
      const existing = this.metadata.prepare('SELECT record FROM operations WHERE undoOf=?').get(operationId);
      if (existing) return this.settled(decode(existing.record));
      const bytes = await this.blobs.readBlob(original.backup);
      return this.commit({ ...options, requestId, target: original.target, baseHash: original.outputHash, bytes, editorRevision: original.editorRevision }, operationId);
    });
  }
  async close(): Promise<void> {
    this.closing = true; await Promise.allSettled(this.locks.values()); this.metadata.close();
  }

  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.closing || this.pending >= 16) throw new DocumentError('CONFLICT', '文件提交队列不可用，请稍后重试。');
    this.pending++;
    const previous = this.locks.get(key) ?? Promise.resolve();
    const result = previous.then(work, work); const tail = result.catch(() => {});
    this.locks.set(key, tail);
    try { return await result; }
    finally { this.pending--; if (this.locks.get(key) === tail) this.locks.delete(key); }
  }
  private async commit(input: CommitInput, undoOf?: string, creation = false): Promise<FileOperation> {
    const outputHash = contentHash(input.bytes);
    const payloadHash = input.requestHash ?? contentHash(Buffer.from(JSON.stringify({ ...input, bytes: outputHash, undoOf, ...(creation && { creation }) })));
    const receipt = this.metadata.prepare('SELECT record FROM operations WHERE requestId=?').get(input.requestId);
    if (receipt) {
      const previous = decode(receipt.record);
      if (previous.payloadHash !== payloadHash) throw new DocumentError('CONFLICT', '同一保存请求对应不同内容。');
      return this.settled(previous);
    }
    const unsettled = this.list().find(record => record.target.fileIdentity === input.target.fileIdentity && ['prepared', 'unknown'].includes(record.state));
    if (unsettled) throw new DocumentError('CONFLICT', '此文件存在未决提交，请先只读对账。');
    input.signal?.throwIfAborted();
    input.admit?.();
    if (input.draft) this.blobs.assertGeneration(input.draft.key, input.draft.generation);
    if (creation && (!this.targets.inspectReference || !this.targets.createReference)) throw new DocumentError('DEPENDENCY_MISSING', '此 Provider 不支持安全新建。');
    const existing = creation ? await this.targets.inspectReference!(input.target) : await this.targets.readReference(input.target);
    if (creation && existing !== null) throw new DocumentError('CONFLICT', '目标已存在，新建不会覆盖文件。');
    const before = existing ?? new Uint8Array();
    if (contentHash(before) !== input.baseHash) throw new DocumentError('CONFLICT', '原件已变化，保存未执行。');
    const candidate = await this.blobs.writeBlob(input.bytes), backup = await this.blobs.writeBlob(before);
    const record: FileOperation = { schema: 1, operationId: randomUUID(), requestId: input.requestId, payloadHash, owner: this.owner,
      kind: creation ? 'create' : undoOf ? 'undo' : 'save', target: input.target, baseHash: input.baseHash, outputHash, candidate, backup,
      editorRevision: input.editorRevision, state: 'prepared', createdAt: new Date().toISOString(), noOp: !creation && input.baseHash === outputHash,
      ...(undoOf && { undoOf }), ...(input.draft && { draft: input.draft }) };
    await this.fault?.('F01', record);
    input.signal?.throwIfAborted();
    input.admit?.();
    this.write(record); // durable prepared always precedes publication
    await this.fault?.('F02', record);
    if (record.noOp) { record.state = 'committed'; this.write(record); this.rebaseDraft(record); return record; }
    try {
      if (input.draft) this.blobs.assertGeneration(input.draft.key, input.draft.generation);
      if (creation) await this.targets.createReference!(record.target, input.bytes);
      else await this.targets.replaceReference(record.target, input.bytes, record.baseHash);
      await this.fault?.('F03', record);
    } catch (error) { record.error = String(error); }
    const result = await this.reconcile(record);
    if (result.state === 'committed') await this.fault?.('F04', result);
    return result;
  }
  private async settled(record: FileOperation): Promise<FileOperation> {
    if (record.state === 'prepared' || record.state === 'unknown') return this.reconcile(record);
    if (record.state === 'committed') this.rebaseDraft(record);
    return record;
  }
  private async reconcile(record: FileOperation): Promise<FileOperation> {
    try {
      // Damaged evidence cannot prove a successful write or provide a sound undo.
      await this.blobs.readBlob(record.candidate); await this.blobs.readBlob(record.backup);
      const bytes = record.kind === 'create' ? await this.targets.inspectReference!(record.target) : await this.targets.readReference(record.target);
      const hash = bytes === null ? null : contentHash(bytes);
      record.state = hash === record.outputHash ? 'committed' : (record.kind === 'create' ? hash === null : hash === record.baseHash) ? 'not_applied' : 'conflict';
      this.write(record);
    } catch (error) { record.state = 'unknown'; record.error = String(error); this.write(record); }
    if (record.state === 'committed') this.rebaseDraft(record);
    return record;
  }
  private rebaseDraft(record: FileOperation): void {
    if (record.draft && !record.draftRebased) {
      this.blobs.markSaved(record.draft.key, record.draft.generation, record.editorRevision, record.baseHash, record.outputHash);
      record.draftRebased = true; this.write(record);
    }
  }
  private write(record: FileOperation): void {
    this.metadata.prepare('INSERT INTO operations VALUES (?, ?, ?, ?) ON CONFLICT(operationId) DO UPDATE SET record=excluded.record')
      .run(record.operationId, record.requestId, record.undoOf ?? null, JSON.stringify(record));
  }
}

function decode(value: unknown): FileOperation {
  if (typeof value !== 'string') throw new Error('Damaged operation journal');
  const record = JSON.parse(value);
  if (!record || record.schema !== 1 || !['save', 'undo', 'create'].includes(record.kind) || !['prepared', 'committed', 'not_applied', 'conflict', 'unknown'].includes(record.state)
    || !['operationId', 'requestId', 'owner', 'createdAt'].every(key => typeof record[key] === 'string')
    || !['payloadHash', 'baseHash', 'outputHash', 'candidate', 'backup'].every(key => typeof record[key] === 'string' && /^[a-f0-9]{64}$/.test(record[key]))
    || !record.target || !['workspaceId', 'relativePath', 'fileIdentity'].every(key => typeof record.target[key] === 'string')
    || !Number.isSafeInteger(record.editorRevision) || record.editorRevision < 0 || typeof record.noOp !== 'boolean'
    || (record.draft && (typeof record.draft.key !== 'string' || typeof record.draft.generation !== 'string'))) throw new Error('Unsupported or damaged operation metadata; evidence preserved');
  return record;
}
