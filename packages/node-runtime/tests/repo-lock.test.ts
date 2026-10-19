import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isIndexLockError, isReadOnlyGit, retryIndexLock, serialRepo } from '../src/git/repo-lock';
import { guardGit } from '../src/git/version-guard';

const lockError = () => new Error("fatal: Unable to create 'C:/w/main/.git/index.lock': File exists.");

describe('repo-lock', () => {
  it('runs writers for one repository strictly one at a time, other repositories in parallel', async () => {
    const log: string[] = []; let active = 0; let peak = 0;
    const job = (name: string, ms: number) => async () => { active++; peak = Math.max(peak, active); log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`); active--; return name; };
    const a = serialRepo('/repo/main', job('a', 30));
    const b = serialRepo('/repo/main/', job('b', 5)); // same repository, different spelling
    const failing = serialRepo('/repo/main', async () => { throw new Error('boom'); });
    const c = serialRepo('/repo/main', job('c', 1));
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
    await expect(failing).rejects.toThrow('boom'); // a failure does not block the queue
    await expect(c).resolves.toBe('c');
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(peak).toBe(1);
    let otherStarted = false;
    const slow = serialRepo('/repo/x', async () => { await new Promise((r) => setTimeout(r, 30)); return otherStarted; });
    await serialRepo('/repo/y', async () => { otherStarted = true; });
    await expect(slow).resolves.toBe(true);
  });

  it('retries index.lock collisions with exponential backoff, and nothing else', async () => {
    const delays: number[] = []; let calls = 0;
    const sleep = async (ms: number) => { delays.push(ms); };
    await expect(retryIndexLock(async () => { calls++; if (calls < 4) throw lockError(); return 'ok'; }, { sleep })).resolves.toBe('ok');
    expect(delays).toEqual([50, 100, 200]);
    calls = 0;
    await expect(retryIndexLock(async () => { calls++; throw new Error('fatal: not a git repository'); }, { sleep })).rejects.toThrow('not a git repository');
    expect(calls).toBe(1);
    calls = 0;
    await expect(retryIndexLock(async () => { calls++; throw lockError(); }, { sleep, attempts: 3 })).rejects.toThrow('index.lock');
    expect(calls).toBe(3);
    expect(isIndexLockError(lockError())).toBe(true);
  });

  it('classifies read-only git commands (they get --no-optional-locks and skip the queue)', () => {
    for (const args of [['status', '--porcelain'], ['diff', '--cached'], ['show', ':a.md'], ['rev-parse', 'HEAD'], ['branch', '--show-current'], ['ls-files', '-s']]) expect(isReadOnlyGit(args)).toBe(true);
    for (const args of [['add', '--', 'a.md'], ['commit', '-m', 'x'], ['update-index', '--cacheinfo'], ['restore', 'a.md'], ['push'], ['branch', '-D', 'x', 'y']]) expect(isReadOnlyGit(args)).toBe(false);
  });

  it('a Version Guard write waits out a held index.lock instead of failing (the Windows CI failure)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'repo-lock-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      git('init', '-q'); git('config', 'user.name', 't'); git('config', 'user.email', 't@e.st');
      await writeFile(path.join(root, 'a.md'), 'a\n');
      const lock = path.join(root, '.git', 'index.lock');
      await writeFile(lock, ''); // another git process holds the index
      setTimeout(() => { void rm(lock, { force: true }); }, 250);
      await guardGit(root, ['add', '--', 'a.md']);
      expect(git('ls-files', '--stage')).toContain('a.md');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
