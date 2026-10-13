/** File-version metadata only. Snapshot bodies are fetched when opening a version. */
export type TimelineSource = 'local' | 'vscode' | 'cursor' | 'git';
export interface TimelineEntry {
  id: string;
  source: TimelineSource;
  filePath: string;
  timestamp: number;
  label: string;
  author?: string;
  revision?: string;
  versionPath?: string;
  previousRevision?: string;
  previousPath?: string;
}
export interface TimelinePage {
  entries: TimelineEntry[];
  cursor?: string;
  errors: Array<{ source: TimelineSource; message: string }>;
}
export interface TimelineComparison {
  entry: TimelineEntry;
  base: string;
  content: string;
  baseLabel: string;
  contentLabel: string;
}
export interface LocalHistorySettings {
  enabled: boolean;
  maxFileSize: number;
  maxFileEntries: number;
  mergeWindow: number;
}
export const DEFAULT_LOCAL_HISTORY_SETTINGS: LocalHistorySettings = {
  enabled: true, maxFileSize: 256, maxFileEntries: 50, mergeWindow: 10,
};
export const isTimelineMarkdown = (filePath: string): boolean => /\.(md|markdown|mdx)$/i.test(filePath);
export interface TimelineUiState { expanded: boolean; height: number }
export interface TimelineClient {
  configureSettings?(): Promise<void>;
  list(filePath: string, sources: TimelineSource[], cursor: string | undefined, signal: AbortSignal): Promise<TimelinePage>;
  open(entry: TimelineEntry, signal: AbortSignal): Promise<void>;
  restore(entry: TimelineEntry, signal: AbortSignal): Promise<void>;
  watch(filePath: string, listener: () => void): { dispose(): void };
  loadState(): TimelineUiState | undefined;
  saveState(state: TimelineUiState): void;
}
export type TimelineRequestMessage =
  | { type: 'timeline.request'; id: string; method: 'list' | 'open' | 'restore'; payload: { filePath?: string; sources?: TimelineSource[]; cursor?: string; entry?: TimelineEntry } }
  | { type: 'timeline.cancel'; id: string }
  | { type: 'timeline.watch'; filePath: string | null };
export type TimelineResultMessage = { type: 'timeline.result'; id: string; value?: unknown; error?: string } | { type: 'timeline.changed' };
