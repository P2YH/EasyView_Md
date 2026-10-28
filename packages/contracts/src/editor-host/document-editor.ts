/** Shared by text and binary editors; capturing never writes the original file. */
export interface EditorState {
  documentId: string;
  editorRevision: number;
  dirty: boolean;
  composing: boolean;
}
export interface DraftSnapshot {
  schema: 1;
  documentId: string;
  format: string;
  sourceDiskHash: string;
  editorRevision: number;
  bytes: Uint8Array;
}
export interface CommitLease { revision: number; release(): void }
export interface DocumentEditorLifecycle {
  snapshot(): EditorState;
  subscribe(listener: (state: EditorState) => void): () => void;
  capture(signal: AbortSignal): Promise<DraftSnapshot>;
  restore(snapshot: DraftSnapshot, signal: AbortSignal): Promise<void>;
  acquireCommitLease(expectedRevision: number, signal: AbortSignal): Promise<CommitLease>;
  acknowledgeSaved(revision: number, diskHash: string): void;
  dispose(): void;
}
