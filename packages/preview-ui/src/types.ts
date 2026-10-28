import type { ReactElement } from 'react';
import type {
  ArchiveEntry,
  ArchiveEntryPreview,
  HttpPreviewRequest,
  HttpPreviewResponse,
  PreviewDescriptor,
  PreviewRoute,
  PreviewTextResult,
  PreviewWriteResult,
} from '@easyview/contracts';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PreviewState {
  descriptor: PreviewDescriptor | null;
  status: PreviewStatus;
  error: string | null;
}

/** Host-injected actions consumed by viewers. Desktop/Extension adapt their APIs here. */
export interface PreviewHost {
  canEdit?: boolean;
  /** Editing recoverable drafts does not imply permission to save originals. */
  canSave?: boolean;
  /** Optional owner registration; disposer belongs to the mounted Viewer generation. */
  registerEditor?(editor: import('./editorLifecycle').DocumentEditorLifecycle): () => void;
  /** Baseline is supplied by the authorized document owner, not inferred from mtime. */
  getSourceDiskHash?(sessionId: string): string;
  getState(): PreviewState;
  subscribe(listener: () => void): () => void;
  readText?(sessionId: string): Promise<PreviewTextResult>;
  /** Persist document-route bytes back to the source file (Excel first; Word/PPT later). */
  writeBytes?(sessionId: string, bytes: Uint8Array): Promise<PreviewWriteResult>;
  saveSnapshot?(snapshot: import('./editorLifecycle').DraftSnapshot): Promise<PreviewWriteResult>;
  listArchive?(sessionId: string): Promise<ArchiveEntry[]>;
  openArchiveEntry?(sessionId: string, path: string): Promise<ArchiveEntryPreview>;
  exportArchiveEntry?(sessionId: string, path: string): Promise<void>;
  decompileJava?(sessionId: string): Promise<string>;
  sendHttp?(request: HttpPreviewRequest): Promise<HttpPreviewResponse>;
}

export interface PreviewAssetConfig {
  /** Desktop's compact toolbar; its host owns the single visibility toggle outside the viewer. */
  compactToolbars?: boolean;
  /** Base URL for @file-viewer/react-full static assets (trailing slash). */
  fileViewerAssetBaseUrl: string;
  /** Base URL for @file-viewer/ppt assets (trailing slash). */
  pptAssetBaseUrl?: string;
  /** Absolute URL to the bundled legacy .doc worker module. */
  docWorkerUrl?: string;
  /** Standalone, cancellable XLSX parser bundle. Required by editable spreadsheets. */
  spreadsheetWorkerUrl?: string;
  /** Absolute URL to the HEIC decode host HTML (Desktop phase-2). */
  heicHostUrl?: string;
  /** Product + per-file preview theme storage. Defaults to localStorage adapter. */
  themeStorage?: import('./theme').PreviewThemeStorage;
}

export type PreviewViewerRenderer = (
  descriptor: PreviewDescriptor,
  host: PreviewHost,
) => ReactElement;

export type PreviewViewerLoader = () => Promise<PreviewViewerRenderer>;

export type PreviewExtraViewers = Partial<Record<PreviewRoute, PreviewViewerLoader>>;
