/** Durable checkpoints: flushed content blobs, transactional metadata and request receipts. */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentHash, DocumentError } from './documents.ts';

export interface DraftRecord {
  schema: 1;
  key: string;
  generation: string;
  format: string;
  sourceDiskHash: string;
  editorRevision: number;
  checkpointRevision: number;
  blobHash: string;
  savedEditorRevision?: number;
}
export interface CheckpointInput {
  key: string;
  generation: string;
  requestId: string;
  expectedCheckpointRevision: number;
  format: string;
  sourceDiskHash: string;
  editorRevision: number;
  bytes: Uint8Array;
  /** For protocol commands whose canonical payload precedes byte serialization. */
  requestHash?: string;
  aiOperationId?: string;
}
export interface AiPatchReceipt {
  operationId: string; key: string; generation: string; baseRevision: number; outputHash: string; inputHash: string;
  state: 'pending' | 'applied' | 'expired'; checkpointRevision?: number;
}

/** SQLite holds a separate lifetime writer lock; a second Host cannot write the same data directory. */
export class DraftStore {
  private readonly owner: DatabaseSync;
  private readonly metadata: DatabaseSync;
  private closed = false;
  private closing: Promise<void> | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  static async open(directory: string): Promise<DraftStore> {
    await mkdir(resolve(directory, 'blobs'), { recursive: true });
    return new DraftStore(directory);
  }

  private constructor(private readonly directory: string) {
    this.owner = new DatabaseSync(resolve(directory, 'writer.sqlite'));
    try { this.owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
    catch (error) { this.owner.close(); throw new Error('EasyView data directory already has a writer', { cause: error }); }
    let metadata: DatabaseSync | undefined;
    try {
      this.metadata = metadata = new DatabaseSync(resolve(directory, 'metadata.sqlite'));
      this.metadata.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;');
      const version = this.metadata.prepare('PRAGMA user_version').get()?.user_version;
      if (typeof version !== 'number' || version > 1) throw new Error('Unsupported EasyView data schema; preserve data and use a compatible plugin');
      this.metadata.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS drafts (key TEXT PRIMARY KEY, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS generations (key TEXT PRIMARY KEY, generation TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS draft_files (key TEXT PRIMARY KEY, fileIdentity TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts (requestId TEXT PRIMARY KEY, payloadHash TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS discards (requestId TEXT PRIMARY KEY, payloadHash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_patches (operationId TEXT PRIMARY KEY, record TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      for (const row of this.metadata.prepare('SELECT record FROM ai_patches').all()) {
        const receipt: AiPatchReceipt = JSON.parse(String(row.record));
        if (receipt.state === 'pending') this.putAiPatch({ ...receipt, state: 'expired' });
      }
    } catch (error) { metadata?.close(); this.owner.close(); throw error; }
  }

  /** A new mounted generation invalidates checkpoints still arriving from its predecessor. */
  begin(key: string, generation: string, fileIdentity?: string): void {
    this.assertLive();
    this.metadata.prepare('INSERT INTO generations VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET generation=excluded.generation').run(key, generation);
    if (fileIdentity) this.metadata.prepare('INSERT INTO draft_files VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET fileIdentity=excluded.fileIdentity').run(key, fileIdentity);
  }

  /** Closed workbenches' dirty recovery copies also block file-level undo. */
  assertFileClean(fileIdentity: string): void {
    for (const row of this.metadata.prepare('SELECT d.record, f.fileIdentity FROM drafts d LEFT JOIN draft_files f ON d.key=f.key').all()) {
      const draft = decodeRecord(row.record);
      if (draft.savedEditorRevision !== draft.editorRevision && (!row.fileIdentity || row.fileIdentity === fileIdentity)) {
        throw new DocumentError('CONFLICT', '此文件仍有未保存的恢复草稿，请先保存或明确丢弃。');
      }
    }
  }

  /** After a verified external commit, remove only clean obsolete copies. */
  retireCleanFile(fileIdentity: string, outputHash: string): void {
    this.metadata.exec('BEGIN IMMEDIATE');
    try {
      for (const row of this.metadata.prepare('SELECT d.key, d.record FROM drafts d JOIN draft_files f ON d.key=f.key WHERE f.fileIdentity=?').all(fileIdentity)) {
        const draft = decodeRecord(row.record);
        if (draft.savedEditorRevision !== draft.editorRevision || draft.sourceDiskHash === outputHash) continue;
        this.metadata.prepare('DELETE FROM drafts WHERE key=?').run(String(row.key));
        this.metadata.prepare('UPDATE generations SET generation=? WHERE key=?').run(randomUUID(), String(row.key));
      }
      this.metadata.exec('COMMIT');
    } catch (error) { this.metadata.exec('ROLLBACK'); throw error; }
  }

  load(key: string): DraftRecord | null {
    this.assertLive();
    const row = this.metadata.prepare('SELECT record FROM drafts WHERE key=?').get(key);
    return row ? decodeRecord(row.record) : null;
  }

  async bytes(record: DraftRecord): Promise<Uint8Array> {
    return this.readBlob(record.blobHash);
  }
  async readBlob(blobHash: string): Promise<Uint8Array> {
    this.assertLive();
    if (!/^[a-f0-9]{64}$/.test(blobHash)) throw new Error('Invalid draft blob reference');
    const bytes = await readFile(resolve(this.directory, 'blobs', blobHash));
    if (contentHash(bytes) !== blobHash) throw new Error('Draft blob is damaged; recovery data has been preserved');
    return bytes;
  }

  async receipt(requestId: string, payloadHash: string): Promise<DraftRecord | null> {
    this.assertLive();
    const receipt = this.metadata.prepare('SELECT payloadHash, record FROM receipts WHERE requestId=?').get(requestId);
    if (!receipt) return null;
    if (receipt.payloadHash !== payloadHash) throw new DocumentError('CONFLICT', '同一请求身份对应不同内容。');
    const record = decodeRecord(receipt.record); await this.bytes(record); return record;
  }

  async writeBlob(bytes: Uint8Array): Promise<string> {
    this.assertLive(); const copy = bytes.slice(); const hash = contentHash(copy); await this.putBlob(hash, copy); return hash;
  }
  aiPatch(operationId: string): AiPatchReceipt | null {
    this.assertLive(); const row = this.metadata.prepare('SELECT record FROM ai_patches WHERE operationId=?').get(operationId);
    return row ? JSON.parse(String(row.record)) : null;
  }
  prepareAiPatch(receipt: AiPatchReceipt): void {
    this.assertGeneration(receipt.key, receipt.generation);
    const previous = this.aiPatch(receipt.operationId);
    if (previous) {
      if (previous.key !== receipt.key || previous.generation !== receipt.generation || previous.baseRevision !== receipt.baseRevision || previous.outputHash !== receipt.outputHash || previous.inputHash !== receipt.inputHash) throw new DocumentError('CONFLICT', 'AI 操作身份冲突。');
      return;
    }
    this.putAiPatch(receipt);
  }
  expireAiPatch(operationId: string): void {
    const receipt = this.aiPatch(operationId);
    if (receipt?.state === 'pending') this.putAiPatch({ ...receipt, state: 'expired' });
  }
  private putAiPatch(receipt: AiPatchReceipt): void {
    this.metadata.prepare('INSERT INTO ai_patches VALUES (?, ?) ON CONFLICT(operationId) DO UPDATE SET record=excluded.record').run(receipt.operationId, JSON.stringify(receipt));
  }
  assertGeneration(key: string, generation: string): void { this.assertLive(); this.checkGeneration({ key, generation }); }
  adoptText(key: string, generation: string): DraftRecord | null {
    this.assertGeneration(key, generation); const record = this.load(key);
    if (!record || record.generation === generation) return record;
    if (!['markdown', 'text'].includes(record.format)) throw new Error('Only protocol text revisions survive a mount unchanged');
    const adopted = { ...record, generation };
    this.metadata.prepare('UPDATE drafts SET record=? WHERE key=?').run(JSON.stringify(adopted), key);
    return adopted;
  }
  markSaved(key: string, generation: string, editorRevision: number, baseHash: string, outputHash: string): void {
    const current = this.load(key);
    if (!current || current.generation !== generation || current.editorRevision < editorRevision) return;
    if (current.sourceDiskHash !== baseHash && current.sourceDiskHash !== outputHash) return; // A later save/conflict owns this baseline.
    this.metadata.prepare('UPDATE drafts SET record=? WHERE key=?').run(JSON.stringify({ ...current, sourceDiskHash: outputHash,
      savedEditorRevision: Math.max(current.savedEditorRevision ?? 0, editorRevision) }), key);
  }
  discard(key: string, generation: string, expectedCheckpointRevision: number, requestId: string): Promise<void> {
    this.assertLive(); if (this.closing) throw new Error('Draft store is closing');
    const task = this.tail.then(() => {
      const payloadHash = contentHash(Buffer.from(JSON.stringify({ key, generation, expectedCheckpointRevision })));
      const previous = this.metadata.prepare('SELECT payloadHash FROM discards WHERE requestId=?').get(requestId);
      if (previous) { if (previous.payloadHash !== payloadHash) throw new DocumentError('CONFLICT', '丢弃请求身份冲突。'); return; }
      this.assertGeneration(key, generation);
      if ((this.load(key)?.checkpointRevision ?? 0) !== expectedCheckpointRevision) throw new DocumentError('CONFLICT', '草稿已更新，取消丢弃。');
      this.metadata.exec('BEGIN IMMEDIATE');
      try {
        this.metadata.prepare('DELETE FROM drafts WHERE key=?').run(key);
        this.metadata.prepare('UPDATE generations SET generation=? WHERE key=?').run(randomUUID(), key);
        this.metadata.prepare('INSERT INTO discards VALUES (?, ?)').run(requestId, payloadHash);
        this.metadata.exec('COMMIT');
      } catch (error) { this.metadata.exec('ROLLBACK'); throw error; }
    });
    this.tail = task.catch(() => {}); return task;
  }

  checkpoint(input: CheckpointInput): Promise<DraftRecord> {
    this.assertLive();
    if (this.closing) throw new Error('Draft store is closing');
    const snapshot = { ...input, bytes: input.bytes.slice() };
    // The only queue entry retained by the caller is its latest capture; accepted
    // work is serialized here so a generation change cannot publish stale metadata.
    const task = this.tail.then(() => this.persist(snapshot));
    this.tail = task.catch(_error => undefined); // The returned task reports the failure; teardown still drains it.
    return task;
  }

  close(): Promise<void> {
    if (!this.closing) this.closing = this.tail.then(() => {
      this.closed = true;
      try { this.metadata.close(); } finally { this.owner.close(); }
    });
    return this.closing;
  }

  private async persist(input: CheckpointInput): Promise<DraftRecord> {
    const blobHash = contentHash(input.bytes);
    const payloadHash = input.requestHash ?? contentHash(Buffer.from(JSON.stringify({ ...input, bytes: blobHash })));
    const receipt = this.metadata.prepare('SELECT payloadHash, record FROM receipts WHERE requestId=?').get(input.requestId);
    if (receipt) {
      if (receipt.payloadHash !== payloadHash) throw new DocumentError('CONFLICT', '同一 requestId 对应不同草稿内容。');
      const record = decodeRecord(receipt.record);
      await this.bytes(record);
      return record;
    }
    this.checkGeneration(input);
    const previous = this.load(input.key);
    if (previous && previous.sourceDiskHash !== input.sourceDiskHash) throw new DocumentError('CONFLICT', '草稿基线已变化，已保留确认版本。');
    if ((previous?.checkpointRevision ?? 0) !== input.expectedCheckpointRevision
      || (previous?.generation === input.generation && input.editorRevision < previous.editorRevision)) {
      throw new DocumentError('CONFLICT', '恢复草稿版本已变化，请重新载入；当前编辑内容仍保留。');
    }
    if (previous?.generation === input.generation && previous.editorRevision === input.editorRevision
      && (previous.blobHash !== blobHash || previous.sourceDiskHash !== input.sourceDiskHash)) {
      throw new DocumentError('CONFLICT', '同一编辑版本不能对应不同内容或磁盘基线。');
    }
    await this.putBlob(blobHash, input.bytes);
    this.checkGeneration(input);
    const record: DraftRecord = { schema: 1, key: input.key, generation: input.generation, format: input.format,
      sourceDiskHash: input.sourceDiskHash, editorRevision: input.editorRevision,
      checkpointRevision: input.expectedCheckpointRevision + 1, blobHash };
    const encoded = JSON.stringify(record);
    const aiPatch = input.aiOperationId ? this.aiPatch(input.aiOperationId) : null;
    if (input.aiOperationId && (!aiPatch || aiPatch.state !== 'pending' || aiPatch.key !== input.key
      || aiPatch.generation !== input.generation || aiPatch.baseRevision + 1 !== input.editorRevision || aiPatch.outputHash !== blobHash)) {
      throw new DocumentError('CONFLICT', 'AI 补丁已失效或与并发输入冲突；当前输入已保留。');
    }
    this.metadata.exec('BEGIN IMMEDIATE');
    try {
      this.metadata.prepare('INSERT INTO drafts VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET record=excluded.record').run(input.key, encoded);
      this.metadata.prepare('INSERT INTO receipts VALUES (?, ?, ?)').run(input.requestId, payloadHash, encoded);
      if (aiPatch) this.putAiPatch({ ...aiPatch, state: 'applied', checkpointRevision: record.checkpointRevision });
      this.metadata.exec('COMMIT');
    } catch (error) { this.metadata.exec('ROLLBACK'); throw error; }
    return record;
  }

  private checkGeneration(input: Pick<CheckpointInput, 'key' | 'generation'>): void {
    if (this.metadata.prepare('SELECT generation FROM generations WHERE key=?').get(input.key)?.generation !== input.generation) {
      throw new DocumentError('CONFLICT', '工作台实例已被替换，旧实例不能继续同步草稿。');
    }
  }

  private async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    const target = resolve(this.directory, 'blobs', hash);
    try {
      const previous = await readFile(target);
      if (contentHash(previous) !== hash) throw new Error('Existing draft blob is damaged');
      return;
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const temporary = resolve(this.directory, 'blobs', `.pending-${randomUUID()}`);
    const file = await open(temporary, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target);
    if (process.platform !== 'win32') {
      const directory = await open(resolve(this.directory, 'blobs'), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }

  private assertLive(): void { if (this.closed) throw new Error('Draft store is closed'); }
}

function decodeRecord(value: unknown): DraftRecord {
  if (typeof value !== 'string') throw new Error('Invalid draft metadata');
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || !('schema' in parsed) || parsed.schema !== 1
    || !('key' in parsed) || typeof parsed.key !== 'string' || !('generation' in parsed) || typeof parsed.generation !== 'string'
    || !('format' in parsed) || typeof parsed.format !== 'string' || !('sourceDiskHash' in parsed) || typeof parsed.sourceDiskHash !== 'string'
    || !('blobHash' in parsed) || typeof parsed.blobHash !== 'string'
    || !('editorRevision' in parsed) || typeof parsed.editorRevision !== 'number' || !Number.isSafeInteger(parsed.editorRevision) || parsed.editorRevision < 0
    || !('checkpointRevision' in parsed) || typeof parsed.checkpointRevision !== 'number' || !Number.isSafeInteger(parsed.checkpointRevision) || parsed.checkpointRevision < 1) {
    throw new Error('Unsupported or damaged draft metadata; recovery data has been preserved');
  }
  return { schema: 1, key: parsed.key, generation: parsed.generation, format: parsed.format, sourceDiskHash: parsed.sourceDiskHash,
    editorRevision: parsed.editorRevision, checkpointRevision: parsed.checkpointRevision, blobHash: parsed.blobHash,
    ...('savedEditorRevision' in parsed && typeof parsed.savedEditorRevision === 'number' && Number.isSafeInteger(parsed.savedEditorRevision)
      && parsed.savedEditorRevision >= 0 && parsed.savedEditorRevision <= parsed.editorRevision ? { savedEditorRevision: parsed.savedEditorRevision } : {}) };
}
