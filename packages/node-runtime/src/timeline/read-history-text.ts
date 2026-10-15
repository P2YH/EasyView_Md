import { open } from 'node:fs/promises';
import { tTimeline } from './timeline.i18n';
export const MAX_HISTORY_READ_BYTES = 32 * 1024 * 1024;
/** Bound allocation before reading, and always close the handle, including cancellation. */
export async function readHistoryText(filePath: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const handle = await open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_HISTORY_READ_BYTES) throw new Error(tTimeline('error.versionTooLarge'));
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    signal?.throwIfAborted();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || offset !== before.size) throw new Error(tTimeline('error.versionChanged'));
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}
