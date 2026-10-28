import type {
  EditorHostSubscription,
  EditorHostTransport,
  HostToEditorMessage,
  EditorToHostMessage,
} from '@easyview/contracts';

export interface DesktopEditorHostTransportOptions {
  capabilities?: EditorHostTransport['capabilities'];
  postMessage(message: EditorToHostMessage): void | Promise<void>;
  subscribe(listener: (message: HostToEditorMessage) => void): EditorHostSubscription;
}

/** Electron renderer transport for the single revision/patch editor protocol. */
export function createDesktopEditorHostTransport(
  options: DesktopEditorHostTransportOptions,
): EditorHostTransport {
  return {
    capabilities: options.capabilities ?? {
      sourceMode: 'embedded',
      git: true,
      terminal: true,
      aiCommitMessage: false,
      aiChat: true,
      documentConversion: true,
      shortcutPersistence: false,
    },
    postMessage: options.postMessage,
    subscribe: options.subscribe,
  };
}
