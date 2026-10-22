import { readHistoryText } from './read-history-text';
import { HistoryTaskQueue } from './task-queue';
const ioQueue = new HistoryTaskQueue(2);
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, copyFile, rm } from 'node:fs/promises';
import { DEFAULT_LOCAL_HISTORY_SETTINGS, isMarkdownFilePath, type LocalHistorySettings, type TimelineEntry } from '@easyview/contracts';
import { writeFileAtomically } from '../filesystem/file-write';
import { tTimeline } from './timeline.i18n';
interface Snapshot extends TimelineEntry { hash: string; snapshot: string }
interface Index { version: 1; filePath: string; entries: Snapshot[]; maxFileEntries: number }
export const contentHash = (content: string): string => createHash('sha256').update(content).digest('hex');
/** Queues are removed on settlement. Regular captures coalesce rather than retaining full documents. */
export class LocalHistoryStore {
  private listeners = new Map<string, Set<() => void>>();
  subscribe(filePath: string, listener: () => void): { dispose(): void } {
    const key = path.resolve(filePath); const listeners = this.listeners.get(key) ?? new Set<() => void>(); listeners.add(listener); this.listeners.set(key, listeners);
    return { dispose: () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); } };
  }
  get subscriptionCount(): number { let count = 0; for (const listeners of this.listeners.values()) count += listeners.size; return count; }

  private queues = new Map<string, Promise<unknown>>();
  private captureTasks = new Map<string, Promise<void>>();
  private pending = new Map<string, { content: string; label: string; settings: LocalHistorySettings }>();
  constructor(readonly root: string) {}
  directory(filePath: string): string { return path.join(this.root, contentHash(path.resolve(filePath))); }
  async list(filePath: string): Promise<TimelineEntry[]> { return (await this.index(filePath)).entries.map(({ hash: _hash, snapshot: _snapshot, ...entry }) => entry); }
  async read(entry: TimelineEntry, signal?: AbortSignal): Promise<string> {
    const found = (await this.index(entry.filePath)).entries.find((item) => item.id === entry.id);
    if (!found) throw new Error(tTimeline('error.versionGone'));
    signal?.throwIfAborted();
    return readHistoryText(path.join(this.directory(entry.filePath), found.snapshot), signal);
  }
  capture(filePath: string, content: string, label = tTimeline('label.saved'), settings = DEFAULT_LOCAL_HISTORY_SETTINGS): Promise<void> {
    if (!isMarkdownFilePath(filePath) || !settings.enabled || settings.maxFileEntries === 0 || Buffer.byteLength(content) > settings.maxFileSize * 1024) return Promise.resolve();
    const key = path.resolve(filePath);
    if (!this.pending.has(key) && this.pending.size >= 64) return Promise.reject(new Error(tTimeline('error.captureBusy')));
    this.pending.set(key, { content, label, settings });
    const scheduled = this.captureTasks.get(key); if (scheduled) return scheduled;
    const capture = this.enqueue(key, async () => {
      while (this.pending.has(key)) {
        const next = this.pending.get(key)!;
        this.pending.delete(key);
        await this.write(key, next.content, next.label, next.settings, false);
      }
    });
    this.captureTasks.set(key, capture);
    void capture.finally(() => { this.captureTasks.delete(key); this.pending.delete(key); }).catch(() => undefined);
    return capture;
  }
  /** Mandatory recovery snapshots bypass capture size/enable limits; never merge them away. */
  preserve(filePath: string, content: string, label: string): Promise<void> {
    return this.enqueue(path.resolve(filePath), () => this.write(filePath, content, label, DEFAULT_LOCAL_HISTORY_SETTINGS, true));
  }
  async migrate(oldPath: string, nextPath: string): Promise<void> {
    const keys = [...new Set([path.resolve(oldPath), path.resolve(nextPath)])];
    const previous = keys.map((key) => this.queues.get(key) ?? Promise.resolve());
    const next = Promise.all(previous.map((task) => task.catch(() => undefined))).then(() => ioQueue.run(async () => {
      const source = await this.index(oldPath);
      if (!source.entries.length) return;
      const target = await this.index(nextPath);
      if (!target.entries.length) target.maxFileEntries = source.maxFileEntries;
      const destination = this.directory(nextPath);
      await mkdir(destination, { recursive: true });
      const migrated: Snapshot[] = [];
      for (const entry of source.entries) {
        const duplicate = target.entries.find((candidate) => candidate.id === entry.id);
        if (duplicate && duplicate.hash !== entry.hash) throw new Error(tTimeline('error.migrationConflict'));
        if (!duplicate) {
          await copyFile(path.join(this.directory(oldPath), entry.snapshot), path.join(destination, entry.snapshot));
          migrated.push({ ...entry, filePath: nextPath });
        }
      }
      target.entries = [...migrated, ...target.entries].sort((a,b) => a.timestamp - b.timestamp);
      const removed = target.entries.splice(0, Math.max(0, target.entries.length - Math.max(3, target.maxFileEntries)));
      await writeFileAtomically(path.join(destination, 'entries.json'), JSON.stringify(target));
      await rm(this.directory(oldPath), { recursive: true });
      for (const entry of removed) await unlink(path.join(destination, entry.snapshot));
      for (const listener of this.listeners.get(path.resolve(nextPath)) ?? []) listener();
    }));
    for (const key of keys) this.queues.set(key, next);
    void next.finally(() => { for (const key of keys) if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    await next;
  }
  async flush(): Promise<void> { await Promise.all(this.queues.values()); }
  get diagnostics() { return { queues: this.queues.size, pending: this.pending.size }; }
  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => ioQueue.run(task));
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }
  private async index(filePath: string): Promise<Index> {
    try {
      const index = JSON.parse(await readFile(path.join(this.directory(filePath), 'entries.json'), 'utf8')) as Index;
      if (index.version !== 1 || index.filePath !== filePath || !Array.isArray(index.entries) || !Number.isInteger(index.maxFileEntries) || index.maxFileEntries < 0) throw new Error(tTimeline('error.invalidLocalIndex'));
      if (index.entries.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.snapshot !== 'string' || path.basename(entry.snapshot) !== entry.snapshot || entry.snapshot !== `${entry.id}.md` || entry.filePath !== filePath || !Number.isFinite(entry.timestamp))) throw new Error(tTimeline('error.invalidLocalEntry'));
      return index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, filePath, entries: [], maxFileEntries: DEFAULT_LOCAL_HISTORY_SETTINGS.maxFileEntries };
      throw error;
    }
  }
  private async write(filePath: string, content: string, label: string, settings: LocalHistorySettings, forced: boolean): Promise<void> {
    const index = await this.index(filePath);
    if (!forced) index.maxFileEntries = settings.maxFileEntries;
    const hash = contentHash(content);
    const last = index.entries.at(-1);
    if (last?.hash === hash && !forced) return;
    const timestamp = Date.now();
    const id = randomUUID();
    const entry: Snapshot = { id, source: 'local', filePath, label, timestamp, hash, snapshot: `${id}.md` };
    const removed: Snapshot[] = [];
    if (!forced && last?.label === label && timestamp - last.timestamp <= settings.mergeWindow * 1000) removed.push(index.entries.pop()!);
    index.entries.push(entry);
    while (index.entries.length > Math.max(forced ? 3 : 1, index.maxFileEntries)) removed.push(index.entries.shift()!);
    const directory = this.directory(filePath);
    await mkdir(directory, { recursive: true });
    await writeFileAtomically(path.join(directory, entry.snapshot), content);
    await writeFileAtomically(path.join(directory, 'entries.json'), JSON.stringify(index));
    for (const old of removed) await unlink(path.join(directory, old.snapshot));
    for (const listener of this.listeners.get(path.resolve(filePath)) ?? []) listener();
  }
}
