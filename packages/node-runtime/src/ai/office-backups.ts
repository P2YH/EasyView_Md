/**
 * Pre-edit copies of Office files written by AI Agent mode.
 *
 * Inside a Git repository the original bytes go into Git itself: unchanged files
 * are already in HEAD, and files with uncommitted edits are written as a blob held
 * by a private `refs/easyview/ai-backups/*` ref, so branches, history and the index
 * stay untouched. Outside Git the copy lives in the app's data directory, never in
 * the user's workspace. Both kinds expire after a retention period.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type OfficeBackupRef =
  | { kind: 'git'; root: string; oid: string; ref?: string }
  | { kind: 'file'; path: string };

export interface OfficeBackupRetention { maxAgeMs: number; maxPerFile: number; maxPerRepository: number }
export const DEFAULT_OFFICE_BACKUP_RETENTION: OfficeBackupRetention = { maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxPerFile: 20, maxPerRepository: 50 };

const REF_PREFIX = 'refs/easyview/ai-backups/';
const MAX_GIT_OUTPUT = 32 * 1024 * 1024;

export class OfficeBackupStore {
  constructor(private readonly directory: string, private readonly retention: OfficeBackupRetention = DEFAULT_OFFICE_BACKUP_RETENTION) {}

  /** Keeps `bytes` (the file's current content) restorable; `id` makes the backup name unique. */
  async save(filePath: string, bytes: Buffer, id: string, now: Date = new Date()): Promise<OfficeBackupRef> {
    const name = `${stamp(now)}_${id.slice(0, 8)}`;
    const snapshot = await this.saveToGit(filePath, bytes, name, now).catch(() => null);
    if (snapshot) return snapshot;
    const directory = path.join(this.directory, name);
    await fs.mkdir(directory, { recursive: true });
    const backupPath = path.join(directory, path.basename(filePath));
    await fs.writeFile(backupPath, bytes, { flag: 'wx' });
    await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ filePath, createdAt: now.getTime() }));
    await this.pruneFiles(now).catch(() => undefined);
    return { kind: 'file', path: backupPath };
  }

  private async saveToGit(filePath: string, bytes: Buffer, name: string, now: Date): Promise<OfficeBackupRef | null> {
    const real = await fs.realpath(filePath);
    const root = (await git(path.dirname(real), ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
    const relative = path.relative(root, real).split(path.sep).join('/');
    if (!relative || relative.startsWith('../')) return null;
    // The user keeps ignored files out of Git on purpose.
    if (await git(root, ['check-ignore', '-q', '--', relative], undefined, { literalPathspecs: false }).then(() => true, () => false)) return null;
    const oid = (await git(root, ['hash-object', '-w', '--no-filters', '--stdin'], bytes)).toString('utf8').trim();
    const head = await git(root, ['rev-parse', '-q', '--verify', `HEAD:${relative}`]).then(out => out.toString('utf8').trim(), () => '');
    if (head === oid) return { kind: 'git', root, oid };
    const ref = `${REF_PREFIX}${name}`;
    await git(root, ['update-ref', ref, oid, '']);
    await this.pruneRefs(root, now).catch(() => undefined);
    return { kind: 'git', root, oid, ref };
  }

  private async pruneRefs(root: string, now: Date): Promise<void> {
    const refs = (await git(root, ['for-each-ref', '--format=%(refname)', REF_PREFIX])).toString('utf8').split('\n').filter(Boolean).sort().reverse();
    for (const [index, ref] of refs.entries()) {
      const created = parseStamp(ref.slice(REF_PREFIX.length));
      if (index >= this.retention.maxPerRepository || (created !== null && now.getTime() - created > this.retention.maxAgeMs)) await git(root, ['update-ref', '-d', ref]);
    }
  }

  private async pruneFiles(now: Date): Promise<void> {
    const entries: Array<{ directory: string; filePath: string; createdAt: number }> = [];
    for (const name of await fs.readdir(this.directory)) {
      const directory = path.join(this.directory, name);
      const meta = await fs.readFile(path.join(directory, 'meta.json'), 'utf8').then(text => JSON.parse(text) as { filePath?: unknown; createdAt?: unknown }, () => null);
      if (meta && typeof meta.filePath === 'string' && typeof meta.createdAt === 'number') entries.push({ directory, filePath: meta.filePath, createdAt: meta.createdAt });
    }
    entries.sort((a, b) => b.createdAt - a.createdAt);
    const perFile = new Map<string, number>();
    for (const entry of entries) {
      const count = (perFile.get(entry.filePath) ?? 0) + 1; perFile.set(entry.filePath, count);
      if (count > this.retention.maxPerFile || now.getTime() - entry.createdAt > this.retention.maxAgeMs) await fs.rm(entry.directory, { recursive: true, force: true });
    }
  }
}

export async function readOfficeBackup(backup: OfficeBackupRef): Promise<Buffer> {
  if (backup.kind === 'file') return fs.readFile(backup.path);
  return git(backup.root, ['cat-file', 'blob', backup.oid]);
}

/** Human-readable location, e.g. for logs or a "restore manually" hint. */
export function describeOfficeBackup(backup: OfficeBackupRef): string {
  return backup.kind === 'file' ? backup.path : `git show ${backup.ref ?? backup.oid}`;
}

/** Local time as `YYYY-MM-DD_HH-mm-ss`; Git ref names and Windows paths forbid `:` and spaces. */
function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function parseStamp(name: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_/.exec(name);
  if (!match) return null;
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
}

/** `check-ignore` rejects literal pathspec magic, so callers can opt out of it. */
function git(cwd: string, args: string[], input?: Buffer, options: { literalPathspecs?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-C', cwd, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: options.literalPathspecs === false ? '0' : '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [], err: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_GIT_OUTPUT) child.kill(); else out.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 && size <= MAX_GIT_OUTPUT ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString('utf8').trim() || `git ${args[0]} failed`)));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
