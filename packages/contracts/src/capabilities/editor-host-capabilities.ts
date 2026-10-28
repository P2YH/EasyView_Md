/** Capabilities exposed by a concrete editor host. */
export interface EditorHostCapabilities {
  sourceMode: 'embedded' | 'native';
  git: boolean;
  terminal: boolean;
  aiCommitMessage: boolean;
  aiChat: boolean;
  /** Host projects stable AI message identities; path-local browser history is disabled. */
  aiChatHistory?: 'host';
  documentConversion: boolean;
  shortcutPersistence: boolean;
}
