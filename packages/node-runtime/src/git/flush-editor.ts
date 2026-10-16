import { randomUUID } from 'node:crypto';
import type { EditorToHostMessage, HostToEditorMessage } from '@easyview/contracts';
/** Flush debounced serialization and await every patch ACK before touching disk/index. */
export function flushGuardEditor(
  documentId: string | undefined,
  send: (message: HostToEditorMessage) => void,
  subscribe: (listener: (message: EditorToHostMessage) => void) => { dispose(): void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Editor synchronization timed out.')); }, 8000);
    const subscription = subscribe(message => {
      if (message.type !== 'documentFlushed' || message.requestId !== requestId) return;
      clearTimeout(timer); subscription.dispose();
      if (message.error) reject(new Error(message.error)); else resolve();
    });
    send({ type: 'flushDocument', documentId, requestId });
  });
}
