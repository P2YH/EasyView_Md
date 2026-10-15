import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomically } from '@easyview/node-runtime';
import type { RecentFolder } from '../../../contracts/workspace';

const MAX_RECENT_FOLDERS = 12;

/** Shared across windows: every window's welcome page lists the same history. */
export class RecentFolderStore {
  private readonly filePath: string;
  private folders: string[] = [];
  private loaded: Promise<void> | undefined;

  constructor(userDataPath: string, private readonly homeDir = os.homedir()) {
    this.filePath = path.join(userDataPath, 'recent-folders.json');
  }

  load(): Promise<void> {
    this.loaded ??= fs.readFile(this.filePath, 'utf8')
      .then((raw) => {
        const parsed = JSON.parse(raw) as unknown;
        this.folders = Array.isArray(parsed)
          ? [...new Set(parsed.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value)))].slice(0, MAX_RECENT_FOLDERS)
          : [];
      })
      .catch(() => { this.folders = []; });
    return this.loaded;
  }

  async list(): Promise<RecentFolder[]> {
    await this.load();
    return Promise.all(this.folders.map(async (folderPath) => ({
      path: folderPath,
      name: path.basename(folderPath) || folderPath,
      displayPath: abbreviateHome(path.dirname(folderPath), this.homeDir),
      exists: await fs.stat(folderPath).then((stat) => stat.isDirectory(), () => false),
    })));
  }

  async paths(): Promise<string[]> {
    await this.load();
    return [...this.folders];
  }

  /** Synchronous view for menu building; empty until `load()` has resolved. */
  snapshot(): string[] {
    return [...this.folders];
  }

  async remember(folderPath: string): Promise<void> {
    await this.load();
    this.folders = [folderPath, ...this.folders.filter((candidate) => candidate !== folderPath)].slice(0, MAX_RECENT_FOLDERS);
    await this.persist();
  }

  async forget(folderPath: string): Promise<void> {
    await this.load();
    const next = this.folders.filter((candidate) => candidate !== folderPath);
    if (next.length === this.folders.length) return;
    this.folders = next;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFileAtomically(this.filePath, JSON.stringify(this.folders, null, 2));
  }
}

export function abbreviateHome(folderPath: string, homeDir: string): string {
  if (!homeDir) return folderPath;
  if (folderPath === homeDir) return '~';
  return folderPath.startsWith(`${homeDir}${path.sep}`) ? `~${folderPath.slice(homeDir.length)}` : folderPath;
}

let sharedStore: RecentFolderStore | undefined;

export function initRecentFolderStore(userDataPath: string): RecentFolderStore {
  sharedStore = new RecentFolderStore(userDataPath);
  return sharedStore;
}

export function recentFolderStore(): RecentFolderStore {
  if (!sharedStore) throw new Error('Recent folder store is not initialized');
  return sharedStore;
}
