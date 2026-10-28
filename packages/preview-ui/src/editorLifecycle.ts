import type { EditorState, DraftSnapshot, CommitLease, DocumentEditorLifecycle } from '@easyview/contracts';
export type { EditorState, DraftSnapshot, CommitLease, DocumentEditorLifecycle } from '@easyview/contracts';

interface ByteEditorOptions {
  documentId: string;
  format: string;
  sourceDiskHash: string;
  root(): HTMLElement | null;
  flushInput(): void;
  serialize(signal: AbortSignal): Promise<Uint8Array>;
  restore(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

/** Owns revision checks, composition waiting and input exclusion for real byte editors. */
export class ByteEditorLifecycle implements DocumentEditorLifecycle {
  private revision = 0;
  private dirty = false;
  private composing = false;
  private disposed = false;
  private leased = false;
  private restoring = false;
  private sourceDiskHash: string;
  private readonly listeners = new Set<(state: EditorState) => void>();
  private readonly lifetime = new AbortController();

  constructor(private readonly options: ByteEditorOptions) { this.sourceDiskHash = options.sourceDiskHash; }

  snapshot(): EditorState {
    return { documentId: this.options.documentId, editorRevision: this.revision, dirty: this.dirty, composing: this.composing };
  }

  subscribe(listener: (state: EditorState) => void): () => void {
    this.assertLive(); this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  changed(): void {
    this.assertLive();
    if (this.restoring) return;
    this.revision++; this.dirty = true; this.emit();
  }

  composition(active: boolean): void { this.assertLive(); this.composing = active; this.emit(); }

  async capture(signal: AbortSignal): Promise<DraftSnapshot> {
    await this.settle(signal);
    const revision = this.revision;
    const bytes = await this.options.serialize(signal);
    this.assertLive(); signal.throwIfAborted();
    // A serializer may traverse mutable state asynchronously. Never label mixed/newer bytes
    // with an earlier revision; the checkpoint queue will capture again after input settles.
    if (this.revision !== revision || this.composing || this.restoring) throw new Error('editor_revision_changed');
    return { schema: 1, documentId: this.options.documentId, format: this.options.format,
      sourceDiskHash: this.sourceDiskHash, editorRevision: revision, bytes: bytes.slice() };
  }

  async restore(snapshot: DraftSnapshot, signal: AbortSignal): Promise<void> {
    await this.settle(signal);
    if (this.leased || this.restoring || snapshot.documentId !== this.options.documentId || snapshot.format !== this.options.format
      || snapshot.schema !== 1 || snapshot.sourceDiskHash !== this.sourceDiskHash) throw new Error('draft_restore_conflict');
    this.restoring = true;
    const root = this.options.root(); const inert = root?.inert ?? false;
    if (root) root.inert = true;
    try {
      await this.options.restore(snapshot.bytes.slice(), signal);
      this.assertLive(); signal.throwIfAborted();
      this.revision = Math.max(this.revision + 1, snapshot.editorRevision); this.dirty = true; this.emit();
    } finally { this.restoring = false; if (root) root.inert = inert; }
  }

  async acquireCommitLease(expectedRevision: number, signal: AbortSignal): Promise<CommitLease> {
    await this.settle(signal);
    if (this.leased || this.restoring || this.revision !== expectedRevision) throw new Error('editor_revision_conflict');
    const root = this.options.root();
    if (!root) throw new Error('editor_not_ready');
    const inert = root.inert;
    root.inert = true; this.leased = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; this.leased = false; root.inert = inert;
      signal.removeEventListener('abort', release); this.lifetime.signal.removeEventListener('abort', release);
    };
    signal.addEventListener('abort', release, { once: true });
    this.lifetime.signal.addEventListener('abort', release, { once: true });
    return { revision: this.revision, release };
  }

  acknowledgeSaved(revision: number, diskHash: string): void {
    this.assertLive(); this.sourceDiskHash = diskHash;
    if (this.revision === revision) this.dirty = false;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.lifetime.abort(new Error('editor_disposed')); this.listeners.clear();
  }

  private async settle(signal: AbortSignal): Promise<void> {
    this.assertLive(); signal.throwIfAborted();
    if (this.composing) await new Promise<void>((resolve, reject) => {
      const cleanup = () => { unsubscribe(); signal.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal.reason ?? this.lifetime.signal.reason); };
      const unsubscribe = this.subscribe(state => { if (!state.composing) { cleanup(); resolve(); } });
      signal.addEventListener('abort', abort, { once: true }); this.lifetime.signal.addEventListener('abort', abort, { once: true });
    });
    this.assertLive(); signal.throwIfAborted();
    if (this.restoring || this.leased) throw new Error('editor_busy');
    this.options.flushInput();
  }

  private assertLive(): void { if (this.disposed) throw new Error('editor_disposed'); }
  private emit(): void { for (const listener of this.listeners) listener(this.snapshot()); }
}
