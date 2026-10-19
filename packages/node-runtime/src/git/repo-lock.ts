import path from 'node:path';

/**
 * Process-wide coordination for git commands that may write `.git/index`.
 *
 * Version Guard, the Markdown file-header git actions and the timeline all run git
 * against the same repositories. Two index writers at once make git fail with
 * "Unable to create '.git/index.lock': File exists". (A plain `git status` counts as
 * a writer: without --no-optional-locks it refreshes the index.) On Windows the lock
 * file also lingers briefly after a process exits.
 * So: writers for one repository run one at a time (`serialRepo`), read-only calls pass
 * `--no-optional-locks`, and a residual lock collision (an external git, editor or
 * antivirus) is retried with backoff (`retryIndexLock`).
 */
const queues = new Map<string, Promise<unknown>>();

export function repoKey(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

export function serialRepo<T>(root: string, action: () => Promise<T>): Promise<T> {
  const key = repoKey(root);
  const result = (queues.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

export function isIndexLockError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}\n${(error as { stderr?: unknown }).stderr ?? ''}` : String(error);
  return /index\.lock['"]?: File exists|Unable to create .*\.lock/i.test(text);
}

export interface RetryOptions { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }

export async function retryIndexLock<T>(action: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  const base = options.baseDelayMs ?? 50;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try { return await action(); }
    catch (error) {
      if (attempt >= attempts || !isIndexLockError(error)) throw error;
      await sleep(base * 2 ** (attempt - 1)); // 50, 100, 200, 400, 800 ms
    }
  }
}

/** Git subcommands that never need to write the index. */
const READ_ONLY = new Set(['status', 'diff', 'show', 'log', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'cat-file', 'branch', 'for-each-ref', 'remote', 'check-ref-format', 'merge-base', 'blame', 'config', 'symbolic-ref', 'describe', 'shortlog', 'name-rev', 'hash-object']);
export function isReadOnlyGit(args: readonly string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'));
  if (!sub || !READ_ONLY.has(sub)) return false;
  // `hash-object -w` writes objects (not the index); branch/remote/config with mutating flags are writers.
  if (sub === 'branch' || sub === 'remote' || sub === 'config') return args.length <= 2 || args.includes('--show-current') || args.includes('--list') || args.includes('--get') || args.includes('-v');
  return true;
}
