import type { EditorSourceDocumentRequest } from '@easyview/contracts';

/** Optional host-native actions kept outside the platform-neutral editor message protocol. */
export interface EasyViewEditorHostActions {
  registerDocumentEditor?(editor: import('@easyview/contracts').DocumentEditorLifecycle): () => void;
  openSourceDocument?(request: EditorSourceDocumentRequest): void;
  persistOpenEditorShortcut?(shortcut: string): void;
  insertIntoITerm?(text: string): void;
  openChatWithPrompt?(prompt: string): void;
}
