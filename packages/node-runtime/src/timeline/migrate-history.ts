import path from 'node:path';
import { opendir, stat, realpath } from 'node:fs/promises';
import { isTimelineMarkdown } from '@easyview/contracts';
import type { LocalHistoryStore } from './local-history';
/** Runs only for an explicit rename; visits the moved subtree, never the history library. */
export async function migrateRenamedHistory(store: LocalHistoryStore, oldPath: string, nextPath: string): Promise<void> {
  const canonicalNext = await realpath(nextPath);
  const canonicalOld = path.join(await realpath(path.dirname(oldPath)), path.basename(oldPath));
  if (canonicalOld === canonicalNext) return;
  if ((await stat(canonicalNext)).isDirectory()) {
    const visit = async (relative: string): Promise<void> => {
      const directory = await opendir(path.join(canonicalNext, relative));
      for await (const entry of directory) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile() && isTimelineMarkdown(entry.name)) await store.migrate(path.join(canonicalOld, child), path.join(canonicalNext, child));
      }
    };
    await visit('');
  } else if (isTimelineMarkdown(canonicalNext)) await store.migrate(canonicalOld, canonicalNext);
}
