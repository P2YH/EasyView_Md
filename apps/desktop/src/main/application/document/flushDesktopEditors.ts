import type { WebContents } from 'electron';
import type { EditorToHostMessage } from '@easyview/contracts';
import { flushGuardEditor } from '@easyview/node-runtime';
import type { DesktopWindowContext } from '../host/windowContext';
import type { DocumentSession } from './documentSession';

const listeners = new Map<number, Set<(message: EditorToHostMessage) => void>>();

export function acceptDesktopEditorFlush(sender: WebContents, message: EditorToHostMessage): boolean {
  if (message.type !== 'documentFlushed') return false;
  listeners.get(sender.id)?.forEach(listener => listener(message));
  return true;
}

export async function flushDesktopEditors(context: DesktopWindowContext, sessions: readonly DocumentSession[]): Promise<void> {
  const contents = context.window?.webContents;
  if (!contents || contents.isDestroyed()) return;
  for (const session of sessions) await flushGuardEditor(session.documentId,
    message => contents.send('editor.message', message),
    listener => {
      const set = listeners.get(contents.id) ?? new Set();
      listeners.set(contents.id, set);
      set.add(listener);
      return { dispose: () => { set.delete(listener); if (!set.size) listeners.delete(contents.id); } };
    });
}
