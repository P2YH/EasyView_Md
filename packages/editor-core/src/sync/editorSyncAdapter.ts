import type { EditorToHostMessage, HostToEditorMessage, TextOffsetPatchPayload } from '@easyview/contracts';
import {
  DocumentSyncSession,
  hashContent,
  applyTextPatches,
  minimalTextPatch,
  type ExternalPatch,
} from '@easyview/editor-sync';

type LocalSource = 'local' | 'undo' | 'redo';

export interface EditorSyncAdapterOptions {
  postMessage: (message: EditorToHostMessage) => void;
  getSettings: () => { fullWidth: boolean; tocVisible: boolean; tableWrap: boolean };
  onSnapshot: (content: string, revision: number, message: Extract<HostToEditorMessage, { type: 'documentSnapshot' }>) => void;
  onExternalContent: (content: string, patches: TextOffsetPatchPayload[], revision: number) => boolean;
}

/** Webview-side protocol adapter. It is the only owner of optimistic document state. */
export class EditorSyncAdapter {
  private session: DocumentSyncSession | null = null;
  private readonly options: EditorSyncAdapterOptions;
  private syncWaiters = new Set<() => void>();
  private outboundSource: LocalSource = 'local';

  constructor(options: EditorSyncAdapterOptions) {
    this.options = options;
  }

  private send(message: Parameters<NonNullable<ConstructorParameters<typeof DocumentSyncSession>[0]['onSend']>>[0]): void {
    if (message.type === 'applyEdits') {
      this.options.postMessage({ type: 'applyEdits', documentId: message.documentId, clientEditId: message.clientEditId, baseRevision: message.baseRevision, edits: message.edits, resultHash: message.resultHash, source: this.outboundSource, ...this.options.getSettings() });
    } else {
      this.options.postMessage({ type: 'requestResync', documentId: message.documentId, revision: message.revision, reason: message.reason });
    }
  }
  get revision(): number { return this.session?.snapshot.revision ?? 0; }
  get documentId(): string | null { return this.session?.documentId ?? null; }
  get content(): string { return this.session?.snapshot.canonicalContent ?? ''; }
  get isReady(): boolean { return this.session !== null; }

  whenSynced(): Promise<void> {
    if (this.session?.snapshot.state === 'synced') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => { if (this.session?.snapshot.state === 'synced') { clearTimeout(timer); this.syncWaiters.delete(finish); resolve(); } };
      const timer = setTimeout(() => { this.syncWaiters.delete(finish); reject(new Error('Editor has unsynchronized changes.')); }, 6000);
      this.syncWaiters.add(finish);
    });
  }

  applyLocalContent(content: string, source: LocalSource = 'local', incremental?: TextOffsetPatchPayload[]): void {
    if (!this.session) return;
    const before = this.session.snapshot.canonicalContent;
    // Validate the incremental result against the optimistic protocol baseline.
    // Structural snapshots/mode changes can invalidate editor-local offsets.
    let edits: TextOffsetPatchPayload[];
    try { edits = incremental && applyTextPatches(before, incremental) === content ? incremental : minimalTextPatch(before, content); }
    catch { edits = minimalTextPatch(before, content); }
    if (edits.length === 0) return;
    this.outboundSource = source;
    this.session.applyLocalEdits(edits);
  }

  handleMessage(message: HostToEditorMessage): boolean {
    switch (message.type) {
      case 'documentSnapshot': {
        const sameDocument = this.session?.documentId === message.documentId;
        const sameRevision = sameDocument && this.session?.snapshot.revision === message.revision;
        const forceReload = message.reason === 'reload' || message.reason === 'resync';
        if (sameRevision && !forceReload) {
          // Tab reactivation of a live instance: keep native + DualModeHistory undo.
          this.options.postMessage({ type: 'snapshotApplied', documentId: message.documentId, revision: message.revision, contentHash: hashContent(message.content) });
          return true;
        }
        if (!this.session || !sameDocument) {
          this.session = new DocumentSyncSession({ documentId: message.documentId, initialContent: message.content, initialRevision: message.revision, onSend: (outbound) => this.send(outbound) });
        } else {
          this.session.applySnapshot(message.content, message.revision);
        }
        this.options.onSnapshot(message.content, message.revision, message);
        this.syncWaiters.forEach(waiter => waiter());
        this.options.postMessage({ type: 'snapshotApplied', documentId: message.documentId, revision: message.revision, contentHash: hashContent(message.content) });
        return true;
      }
      case 'editsApplied':
        this.session?.handleAck(message);
        this.syncWaiters.forEach(waiter => waiter());
        return true;
      case 'documentPatched': {
        if (!this.session) return true;
        const before = this.session.snapshot.canonicalContent;
        const external: ExternalPatch = { type: 'documentPatched', documentId: message.documentId, baseRevision: message.baseRevision, revision: message.revision, edits: message.edits, resultHash: message.resultHash };
        this.session.handleExternalPatch(external);
        const snapshot = this.session.snapshot;
        if (snapshot.state === 'resyncing') return true;
        if (snapshot.state === 'conflict') { this.session.requestResync('External patch conflicts with local edits'); return true; }
        const visiblePatches = minimalTextPatch(before, snapshot.canonicalContent);
        if (!this.options.onExternalContent(snapshot.canonicalContent, visiblePatches, message.revision)) {
          this.session.requestResync('External patch requires a structural snapshot');
        }
        return true;
      }
      case 'documentActivate': {
        const session = this.session;
        if (!session || session.documentId !== message.documentId) {
          this.options.postMessage({
            type: 'requestResync',
            documentId: message.documentId,
            revision: message.revision,
            reason: 'Activate without a live document session',
          });
          return true;
        }
        const { state } = session.snapshot;
        if (state === 'awaitingAck' || state === 'awaitingAckWithBufferedEdits' || state === 'resyncing') {
          // Local edits are still in flight, so the host revision/hash in this
          // activation legitimately differs from the editor's optimistic content.
          // The pending ACK reconciles it (and the host rejects a truly divergent
          // edit with resyncRequired). Resyncing here would replace the document
          // with the host copy and drop the unacknowledged keystrokes.
          return true;
        }
        const currentHash = hashContent(session.snapshot.canonicalContent);
        if (session.snapshot.revision === message.revision && currentHash === message.contentHash) {
          this.options.postMessage({
            type: 'snapshotApplied',
            documentId: message.documentId,
            revision: message.revision,
            contentHash: currentHash,
          });
          return true;
        }
        session.requestResync('Activate revision or hash mismatch');
        return true;
      }
      case 'resyncRequired':
        this.session?.requestResync(message.reason);
        return true;
      default:
        return false;
    }
  }

  requestResync(reason: string): void { this.session?.requestResync(reason); }
  dispose(): void { this.session?.dispose(); this.session = null; }
}
