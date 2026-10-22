import { readHistoryText, MAX_HISTORY_READ_BYTES } from './read-history-text';
import { HistoryTaskQueue } from './task-queue';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import type { TimelineComparison, TimelineEntry, TimelinePage, TimelineSource } from '@easyview/contracts';
import { isMarkdownFilePath } from '@easyview/contracts';
import { LocalHistoryStore } from './local-history';
import { type HostHistoryRoot, hostHistoryHash, hostHistoryUri } from './history-roots';
import { listGitHistory, readGitVersion } from './git-history';
import { tTimeline } from './timeline.i18n';
import { getLocale } from '@easyview/contracts/i18n';
interface HostIndex { version: number; resource: string; entries: Array<{ id: string; timestamp: number; source?: string; sourceDescription?: string }> }
const sourceLabel = (source?: string) => source === 'undoRedo.source' ? tTimeline('label.undoRedo') : source === 'localHistoryRestore.source' ? tTimeline('label.restored') : source === 'default.source' || !source ? tTimeline('label.saved') : source;
/** Stateless queries: no whole-library cache and no snapshot bodies in the list. */
export class TimelineService {
  readonly local: LocalHistoryStore;
  private queryQueue = new HistoryTaskQueue(2);
  private readQueue = new HistoryTaskQueue(2);
  private watchers = new Set<FSWatcher>();
  private disposed = false;
  private queries = 0;
  constructor(root: string, readonly hostRoots: HostHistoryRoot[] = []) { this.local = new LocalHistoryStore(root); }
  list(filePath: string, sources: TimelineSource[], cursor?: string, signal?: AbortSignal): Promise<TimelinePage> {
    return this.queryQueue.run(() => this.listPage(filePath, sources, cursor, signal), signal);
  }
  private async listPage(filePath: string, sources: TimelineSource[], cursor?: string, signal?: AbortSignal): Promise<TimelinePage> {
    if (this.disposed) throw new Error(tTimeline('error.closed'));
    this.queries++;
    signal?.throwIfAborted();
    if (!isMarkdownFilePath(filePath)) return { entries: [], errors: [] };
    const paging = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offsets: Record<string, number>; git?: { revision: string; path: string } | null } : { offsets: {} as Record<string, number>, git: undefined };
    if (!paging.offsets || Object.values(paging.offsets).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error(tTimeline('error.invalidPaging'));
    const all: Array<{ key: string; entry: TimelineEntry }> = [], errors: TimelinePage['errors'] = [];
    const query = async (key: string, source: TimelineSource, load: () => Promise<TimelineEntry[]>) => {
      try {
        signal?.throwIfAborted();
        const items = await load();
        signal?.throwIfAborted();
        const sorted = source === 'git' ? items : items.reverse().sort((a,b) => b.timestamp - a.timestamp);
        const offset = paging.offsets[key] ?? 0;
        all.push(...(source === 'git' ? sorted.slice(0, 51) : sorted.slice(offset, offset + 51)).map((entry) => ({ key, entry })));
      } catch (error) { signal?.throwIfAborted(); errors.push({ source, message: error instanceof Error ? error.message : String(error) }); }
    };
    if (sources.includes('local')) await query('local', 'local', () => this.local.list(filePath));
    for (const [i, root] of this.hostRoots.entries()) if (sources.includes(root.source)) await query(`host:${i}`, root.source, () => this.listHost(filePath, root));
    if (sources.includes('git') && paging.git !== null) await query('git', 'git', () => listGitHistory(filePath, 50, signal, paging.git ?? undefined));
    signal?.throwIfAborted();
    all.sort((a,b) => b.entry.timestamp - a.entry.timestamp || a.entry.source.localeCompare(b.entry.source));
    const selected = all.slice(0, 50);
    for (const { key, entry } of selected) {
      if (key === 'git') paging.git = entry.previousRevision ? { revision: entry.previousRevision, path: entry.previousPath! } : null;
      else paging.offsets[key] = (paging.offsets[key] ?? 0) + 1;
    }
    return { entries: selected.map((item) => item.entry), cursor: all.length > 50 ? Buffer.from(JSON.stringify(paging)).toString('base64url') : undefined, errors };
  }

  read(entry: TimelineEntry, signal?: AbortSignal): Promise<string> {
    return this.readQueue.run(() => this.readVersion(entry, signal), signal);
  }
  private async readVersion(entry: TimelineEntry, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (entry.source === 'git') return readGitVersion(entry, false, signal);
    if (entry.source === 'local') return this.local.read(entry, signal);
    const match = /^([^:]+):(.+)$/.exec(entry.id);
    if (!match) throw new Error(tTimeline('error.invalidHostVersion'));
    const root = this.hostRoots[Number(match[1])];
    if (!root || root.source !== entry.source) throw new Error(tTimeline('error.invalidHostSource'));
    const index = await this.listHost(entry.filePath, root);
    if (!index.some((item) => item.id === entry.id && item.timestamp === entry.timestamp)) throw new Error(tTimeline('error.hostVersionGone'));
    if (path.basename(match[2]) !== match[2]) throw new Error(tTimeline('error.invalidHostPath'));
    return readHistoryText(path.join(this.hostDirectory(entry.filePath, root), match[2]), signal);
  }
  async compare(entry: TimelineEntry, current: string, signal?: AbortSignal): Promise<TimelineComparison> {
    if (Buffer.byteLength(current) > MAX_HISTORY_READ_BYTES) throw new Error(tTimeline('error.currentTooLarge'));
    const version = await this.read(entry, signal);
    const base = entry.source === 'git' ? await readGitVersion(entry, true, signal) : version;
    signal?.throwIfAborted();
    return {
      entry, base, content: entry.source === 'git' ? version : current,
      baseLabel: entry.source === 'git' ? entry.previousRevision?.slice(0, 8) ?? tTimeline('label.emptyFile') : new Date(entry.timestamp).toLocaleString(getLocale()),
      contentLabel: entry.source === 'git' ? entry.revision!.slice(0, 8) : tTimeline('label.currentFile'),
    };
  }
  watch(filePath: string, changed: () => void): { dispose(): void } {
    if (this.disposed) throw new Error(tTimeline('error.closed'));
    const owned: FSWatcher[] = [];
    const localSubscription = this.local.subscribe(filePath, changed);
    for (const directory of this.hostRoots.filter((root) => !root.error).map((root) => this.hostDirectory(filePath, root))) {
      try {
        const watcher = watch(directory, (_event, fileName) => { if (fileName?.toString() === 'entries.json') changed(); });
        watcher.on('error', () => { watcher.close(); this.watchers.delete(watcher); });
        owned.push(watcher); this.watchers.add(watcher);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { localSubscription.dispose(); for (const watcher of owned) { watcher.close(); this.watchers.delete(watcher); } throw error; } }
    }
    return { dispose: () => { localSubscription.dispose(); for (const watcher of owned) { watcher.close(); this.watchers.delete(watcher); } } };
  }
  get diagnostics() { return { queries: this.queries, watchers: this.watchers.size + this.local.subscriptionCount, ...this.local.diagnostics }; }
  dispose(): void { this.disposed = true; for (const watcher of this.watchers) watcher.close(); this.watchers.clear(); }
  private hostDirectory(filePath: string, root: HostHistoryRoot): string { return path.join(root.path, hostHistoryHash(hostHistoryUri(filePath))); }
  private async listHost(filePath: string, root: HostHistoryRoot): Promise<TimelineEntry[]> {
    if (root.error) throw new Error(root.error);
    const directory = this.hostDirectory(filePath, root);
    let index: HostIndex;
    try {
      const info = await stat(path.join(directory, 'entries.json'));
      if (info.size > 4 * 1024 * 1024) throw new Error(tTimeline('error.hostIndexTooLarge'));
      index = JSON.parse(await readFile(path.join(directory, 'entries.json'), 'utf8')) as HostIndex;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (index.version !== 1 || index.resource !== hostHistoryUri(filePath) || !Array.isArray(index.entries)) throw new Error(tTimeline('error.hostIndexMismatch'));
    return index.entries.map((entry) => {
      if (!entry || typeof entry.id !== 'string' || path.basename(entry.id) !== entry.id || !Number.isFinite(entry.timestamp)) throw new Error(tTimeline('error.invalidHostEntry'));
      return { id: `${this.hostRoots.indexOf(root)}:${entry.id}`, source: root.source, filePath, timestamp: entry.timestamp, label: entry.sourceDescription ?? sourceLabel(entry.source) };
    });
  }
}
