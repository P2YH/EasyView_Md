import type { CommitLease, DocumentEditorLifecycle, DraftSnapshot, EditorState } from '@easyview/contracts';

interface TextEditorOptions {
  documentId: string;
  format: 'markdown' | 'text';
  sourceDiskHash: string;
  savedEditorRevision: number;
  root: HTMLElement;
  revision(): number;
  content(): string;
  flush(): Promise<void>;
  restore(content: string): Promise<void>;
}

// The toolbar and AI panel can live outside an editor's subtree. A shared page
// lease excludes their input too, and concurrent leases restore the prior state.
const pageLeases = new WeakMap<HTMLElement, { count: number; inert: boolean }>();

/** Uses the real editor-sync revision, including buffered input and durable ACKs. */
export class TextEditorLifecycle implements DocumentEditorLifecycle {
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<(state: EditorState) => void>();
  private composing = false;
  private changedSinceSave = false;
  private leased = false;
  private disposed = false;
  private diskHash: string;
  private savedRevision: number;
  constructor(private readonly options: TextEditorOptions) {
    this.diskHash = options.sourceDiskHash; this.savedRevision = options.savedEditorRevision;
    options.root.addEventListener('compositionstart', () => { this.composing = true; this.emit(); }, { signal: this.lifetime.signal });
    options.root.addEventListener('compositionend', () => { this.composing = false; this.emit(); }, { signal: this.lifetime.signal });
  }
  snapshot(): EditorState {
    return { documentId: this.options.documentId, editorRevision: this.options.revision(),
      dirty: this.changedSinceSave || this.options.revision() !== this.savedRevision, composing: this.composing };
  }
  subscribe(listener: (state: EditorState) => void): () => void {
    this.assertLive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  changed() { this.assertLive(); this.changedSinceSave = true; this.emit(); }
  acknowledged() { if (!this.disposed) this.emit(); }
  assertWritable() { this.assertLive(); if (this.leased) throw new Error('editor_busy'); }
  get committing() { return this.leased; }
  async capture(signal: AbortSignal): Promise<DraftSnapshot> {
    await this.settle(signal);
    return { schema: 1, documentId: this.options.documentId, format: this.options.format,
      sourceDiskHash: this.diskHash, editorRevision: this.options.revision(), bytes: new TextEncoder().encode(this.options.content()) };
  }
  async restore(snapshot: DraftSnapshot, signal: AbortSignal): Promise<void> {
    await this.settle(signal);
    if (snapshot.schema !== 1 || snapshot.documentId !== this.options.documentId || snapshot.format !== this.options.format
      || snapshot.sourceDiskHash !== this.diskHash || snapshot.editorRevision !== this.options.revision()) throw new Error('draft_restore_conflict');
    // Restoration is a new normal edit, with its own durable ACK; no synthetic
    // revision reset can make an old snapshot overwrite buffered manual input.
    await this.options.restore(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes));
    this.assertLive(); signal.throwIfAborted(); this.changedSinceSave = true; this.emit();
  }
  async acquireCommitLease(expectedRevision: number, signal: AbortSignal): Promise<CommitLease> {
    await this.settle(signal);
    this.assertWritable();
    if (this.options.revision() !== expectedRevision) throw new Error('editor_revision_conflict');
    const page = this.options.root.ownerDocument.body;
    let lock = pageLeases.get(page);
    if (!lock) { lock = { count: 0, inert: page.inert }; pageLeases.set(page, lock); }
    lock.count++; page.inert = true; this.leased = true;
    let released = false;
    const release = () => {
      if (released) return; released = true; this.leased = false;
      if (--lock.count === 0) { page.inert = lock.inert; pageLeases.delete(page); }
      signal.removeEventListener('abort', release); this.lifetime.signal.removeEventListener('abort', release);
    };
    signal.addEventListener('abort', release, { once: true }); this.lifetime.signal.addEventListener('abort', release, { once: true });
    return { revision: expectedRevision, release };
  }
  acknowledgeSaved(revision: number, diskHash: string) {
    this.assertLive(); this.diskHash = diskHash; this.savedRevision = revision;
    if (revision === this.options.revision()) this.changedSinceSave = false;
    this.emit();
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.lifetime.abort(new Error('editor_disposed')); this.listeners.clear(); }
  private async settle(signal: AbortSignal) {
    this.assertWritable(); signal.throwIfAborted();
    if (this.composing) await new Promise<void>((resolve, reject) => {
      const cleanup = () => { stop(); signal.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal.reason ?? this.lifetime.signal.reason); };
      const stop = this.subscribe(state => { if (!state.composing) { cleanup(); resolve(); } });
      signal.addEventListener('abort', abort, { once: true }); this.lifetime.signal.addEventListener('abort', abort, { once: true });
    });
    await this.options.flush();
    this.assertWritable(); signal.throwIfAborted();
    if (this.composing) throw new Error('editor_composing');
  }
  private assertLive() { if (this.disposed) throw new Error('editor_disposed'); }
  private emit() { for (const listener of this.listeners) listener(this.snapshot()); }
}
