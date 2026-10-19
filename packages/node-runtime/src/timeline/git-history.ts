import { realpath } from 'node:fs/promises';
import { HistoryTaskQueue } from './task-queue';
const gitQueue = new HistoryTaskQueue(1);
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { TimelineEntry } from '@easyview/contracts';
import { tTimeline } from './timeline.i18n';
/** No shell; AbortSignal terminates Git, and output is bounded. */
export function historyGit(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return gitQueue.run(() => new Promise<string>((resolve, reject) => {
    execFile('git', ['--no-optional-locks', '-C', root, ...args], { signal, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(signal?.aborted ? tTimeline('error.cancelled') : stderr.trim() || error.message));
      else resolve(stdout);
    });
  }), signal);
}
export async function listGitHistory(filePath: string, limit: number, signal?: AbortSignal, cursor?: { revision: string; path: string }): Promise<TimelineEntry[]> {
  let root: string;
  try { root = (await historyGit(path.dirname(filePath), ['rev-parse', '--show-toplevel'], signal)).trim(); }
  catch (error) {
    signal?.throwIfAborted();
    if (String(error).includes('not a git repository')) return [];
    throw error;
  }
  const relative = cursor?.path ?? path.relative(root, await realpath(filePath)).split(path.sep).join('/');
  if (path.isAbsolute(relative) || relative.split('/').includes('..') || (cursor && !/^[a-f0-9]{40,64}$/.test(cursor.revision))) throw new Error(tTimeline('error.invalidGitPaging'));
  let output: string;
  try { output = await historyGit(root, ['log', '--follow', `--max-count=${limit + 1}`, '--format=%x1e%H%x00%ct%x00%an%x00%s%x00', '--name-status', '-z', ...(cursor ? [cursor.revision] : []), '--', relative], signal); } catch (error) { signal?.throwIfAborted(); if (String(error).includes('does not have any commits yet')) return []; throw error; }
  const entries: TimelineEntry[] = [];
  let versionPath = relative;
  for (const chunk of output.split('\x1e').slice(1)) {
    const [revision, timestamp, author, label, ...changes] = chunk.split('\0');
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error(tTimeline('error.invalidGitHistory'));
    const entry: TimelineEntry = { id: revision, source: 'git', filePath, timestamp: Number(timestamp) * 1000, author, label, revision, versionPath };
    const tokens = changes.map((part) => part.replace(/^\n/, ''));
    for (let i = 0; i < tokens.length; i++) {
      if (/^R\d+$/.test(tokens[i])) {
        const oldPath = tokens[++i], nextPath = tokens[++i];
        if (nextPath === versionPath) versionPath = oldPath;
      }
    }
    entry.previousPath = versionPath;
    entries.push(entry);
  }
  for (let i = 0; i < entries.length; i++) entries[i].previousRevision = entries[i + 1]?.revision;
  return entries;
}
export async function readGitVersion(entry: TimelineEntry, previous: boolean, signal?: AbortSignal): Promise<string> {
  if (previous && !entry.previousRevision) return '';
  const revision = previous ? entry.previousRevision : entry.revision;
  const versionPath = previous ? entry.previousPath : entry.versionPath;
  if (!revision || !/^[a-f0-9]{40,64}$/.test(revision) || !versionPath || path.isAbsolute(versionPath) || versionPath.split('/').includes('..')) throw new Error(tTimeline('error.invalidGitVersion'));
  const root = (await historyGit(path.dirname(entry.filePath), ['rev-parse', '--show-toplevel'], signal)).trim();
  return historyGit(root, ['show', `${revision}:${versionPath}`], signal);
}
