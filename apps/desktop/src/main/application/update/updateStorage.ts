import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { compareVersions, parseVersion } from './updateCore';

export type StorageLog = (message: string) => void;

export interface CleanupOptions {
  root: string;
  currentVersion: string;
  /** Version currently being downloaded / offered; kept even if it is the newest. */
  keepVersion?: string;
  /** Max number of version directories retained (newest first). */
  maxRetained?: number;
  log?: StorageLog;
}

/**
 * Removes stale update downloads:
 * - version dirs <= current app version (already installed or older)
 * - any `.part` temp file left by a crashed/cancelled download
 * - non-version entries
 * - all but the newest `maxRetained` pending versions (keepVersion always kept)
 */
export async function cleanupUpdateDirectory(options: CleanupOptions): Promise<string[]> {
  const { root, currentVersion, keepVersion, maxRetained = 1, log = () => {} } = options;
  const removed: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return removed;
  }
  const remove = async (target: string, reason: string) => {
    await rm(target, { recursive: true, force: true });
    removed.push(target);
    log(`removed ${path.basename(path.dirname(target)) === path.basename(root) ? path.basename(target) : path.relative(root, target)} (${reason})`);
  };
  const pending: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (!entry.isDirectory() || !parseVersion(entry.name)) {
      await remove(full, 'unexpected entry');
      continue;
    }
    if (compareVersions(entry.name, currentVersion) <= 0) {
      await remove(full, `not newer than ${currentVersion}`);
      continue;
    }
    for (const file of await readdir(full)) {
      if (file.endsWith('.part')) await remove(path.join(full, file), 'stale partial download');
    }
    pending.push(entry.name);
  }
  pending.sort((a, b) => compareVersions(b, a));
  const keep = new Set(pending.slice(0, Math.max(0, maxRetained)));
  if (keepVersion) keep.add(keepVersion);
  for (const version of pending) {
    if (!keep.has(version)) await remove(path.join(root, version), 'exceeds retention cap');
  }
  return removed;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve()).on('error', reject);
  });
  return hash.digest('hex');
}

/** Returns the path if a previously downloaded installer exists and matches the checksum. */
export async function findVerifiedDownload(filePath: string, expectedSha256: string, log: StorageLog = () => {}): Promise<string | undefined> {
  try {
    if (!(await stat(filePath)).isFile()) return undefined;
  } catch {
    return undefined;
  }
  const actual = await sha256File(filePath);
  if (actual === expectedSha256.toLowerCase()) return filePath;
  log(`existing download checksum mismatch, deleting ${path.basename(filePath)}`);
  await rm(filePath, { force: true });
  return undefined;
}
