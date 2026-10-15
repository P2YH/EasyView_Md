import type { HostToEditorMessage } from '@easyview/contracts/protocol';
import { tEditorCore } from './editorCore.i18n';

export interface HostMessageSideEffectHandlers {
  onCommitMessageGenerated(message: string, source: string): void;
  onCommitMessageGenerationFailed(message: string): void;
  onStageFileCompleted(message: string): void;
  onStageFileFailed(message: string): void;
  onCommitFileCompleted(message: string): void;
  onCommitFileFailed(message: string): void;
  onSyncFileCompleted(message: string): void;
  onSyncFileFailed(message: string): void;
  onClipboardCopyCompleted(message: string): void;
  onClipboardCopyFailed(message: string): void;
  onFocus(): void;
  onRevealCursor(line: number, totalLines?: number): void;
  onFileRenamed(fileName: string): void;
  onRequestExportHtml(theme: 'light' | 'dark'): void;
  onRequestExportPdf(theme: 'light' | 'dark'): void;
  onRequestExportDocx(): void;
  onImageSelected(message: Extract<HostToEditorMessage, { type: 'imageSelected' }>): void;
  onImagesDropped(message: Extract<HostToEditorMessage, { type: 'imagesDropped' }>): void;
}

/**
 * Routes Host messages whose behavior is independent of document synchronization.
 * Keeping this separate leaves the main editor switch responsible only for content
 * and Git state reconciliation.
 */
export function handleHostMessageSideEffect(
  message: HostToEditorMessage,
  handlers: HostMessageSideEffectHandlers,
): boolean {
  switch (message.type) {
    case 'commitMessageGenerated':
      handlers.onCommitMessageGenerated(message.message, message.source || tEditorCore('commit.generated'));
      return true;
    case 'commitMessageGenerationFailed':
      handlers.onCommitMessageGenerationFailed(message.message || tEditorCore('commit.generateFailed'));
      return true;
    case 'stageFileCompleted':
      handlers.onStageFileCompleted(message.message || tEditorCore('git.staged'));
      return true;
    case 'stageFileFailed':
      handlers.onStageFileFailed(message.message || tEditorCore('git.stageFailed'));
      return true;
    case 'commitFileCompleted':
      handlers.onCommitFileCompleted(message.message || tEditorCore('git.committed'));
      return true;
    case 'commitFileFailed':
      handlers.onCommitFileFailed(message.message || tEditorCore('git.commitFailed'));
      return true;
    case 'syncFileCompleted':
      handlers.onSyncFileCompleted(message.message || tEditorCore('git.synced'));
      return true;
    case 'syncFileFailed':
      handlers.onSyncFileFailed(message.message || tEditorCore('git.syncFailed'));
      return true;
    case 'clipboardCopyCompleted':
      handlers.onClipboardCopyCompleted(message.message || tEditorCore('copied'));
      return true;
    case 'clipboardCopyFailed':
      handlers.onClipboardCopyFailed(message.message || tEditorCore('copyFailed'));
      return true;
    case 'focus':
      handlers.onFocus();
      return true;
    case 'revealCursor':
      handlers.onRevealCursor(message.line, message.totalLines);
      return true;
    case 'fileRenamed':
      handlers.onFileRenamed(message.fileName);
      return true;
    case 'requestExportHtml':
      handlers.onRequestExportHtml(message.theme || 'light');
      return true;
    case 'requestExportPdf':
      handlers.onRequestExportPdf(message.theme || 'light');
      return true;
    case 'requestExportDocx':
      handlers.onRequestExportDocx();
      return true;
    case 'imageSelected':
      handlers.onImageSelected(message);
      return true;
    case 'imagesDropped':
      handlers.onImagesDropped(message);
      return true;
    default:
      return false;
  }
}
