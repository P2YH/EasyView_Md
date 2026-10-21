import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OfficeBackupStore, readOfficeBackup } from './office-backups';

describe('office backups', () => {
  let root = '';
  let repo = '';
  let appData = '';
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const refs = () => git('for-each-ref', '--format=%(refname)', 'refs/easyview/ai-backups/').split('\n').filter(Boolean);
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'easyview-office-backups-')));
    repo = path.join(root, 'repo'); appData = path.join(root, 'app-data');
    await mkdir(repo); git('init', '-q'); git('config', 'user.name', 'Backup'); git('config', 'user.email', 'backup@example.test');
    await writeFile(path.join(repo, 'book.xlsx'), 'committed'); await writeFile(path.join(repo, '.gitignore'), 'private/\n');
    git('add', '.'); git('commit', '-qm', 'initial');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('reuses HEAD for an unchanged tracked file without writing anything', async () => {
    const backup = await new OfficeBackupStore(appData).save(path.join(repo, 'book.xlsx'), Buffer.from('committed'), 'id-clean');
    expect(backup).toEqual({ kind: 'git', root: repo, oid: git('rev-parse', 'HEAD:book.xlsx') });
    expect(refs()).toEqual([]);
    expect((await readOfficeBackup(backup)).toString()).toBe('committed');
    await expect(readdir(appData)).rejects.toThrow();
  });

  it('snapshots uncommitted edits into Git without touching branches, history, index or worktree', async () => {
    const file = path.join(repo, 'book.xlsx');
    await writeFile(file, 'staged'); git('add', 'book.xlsx'); await writeFile(file, 'manual edit');
    const before = { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'), index: git('rev-parse', ':book.xlsx'), branches: git('branch', '--list') };
    const backup = await new OfficeBackupStore(appData).save(file, Buffer.from('manual edit'), 'id-dirty', new Date(2026, 9, 21, 9, 2, 3, 4));
    expect(backup).toMatchObject({ kind: 'git', root: repo, ref: 'refs/easyview/ai-backups/2026-10-21_09-02-03_id-dirty' });
    expect(git('show', 'refs/easyview/ai-backups/2026-10-21_09-02-03_id-dirty')).toBe('manual edit');
    expect({ head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'), index: git('rev-parse', ':book.xlsx'), branches: git('branch', '--list') }).toEqual(before);
    expect((await readOfficeBackup(backup)).toString()).toBe('manual edit');
  });

  it('snapshots untracked files but keeps ignored files and non-repositories in app data', async () => {
    const store = new OfficeBackupStore(appData);
    await writeFile(path.join(repo, 'new.xlsx'), 'untracked');
    expect(await store.save(path.join(repo, 'new.xlsx'), Buffer.from('untracked'), 'id-new')).toMatchObject({ kind: 'git' });
    await mkdir(path.join(repo, 'private')); await writeFile(path.join(repo, 'private', 'secret.xlsx'), 'ignored');
    const ignored = await store.save(path.join(repo, 'private', 'secret.xlsx'), Buffer.from('ignored'), 'id-ignored');
    const outside = path.join(root, 'plain.xlsx'); await writeFile(outside, 'plain');
    const plain = await store.save(outside, Buffer.from('plain'), 'id-plain');
    for (const backup of [ignored, plain]) expect(backup.kind === 'file' && backup.path.startsWith(appData)).toBe(true);
    expect((await readOfficeBackup(plain)).toString()).toBe('plain');
    expect(git('status', '--porcelain')).toBe('?? new.xlsx');
  });

  it('expires old snapshots and caps copies per file', async () => {
    const store = new OfficeBackupStore(appData, { maxAgeMs: 24 * 60 * 60 * 1000, maxPerFile: 2, maxPerRepository: 50 });
    const file = path.join(repo, 'book.xlsx'); await writeFile(file, 'edit');
    await store.save(file, Buffer.from('old'), 'aaaaaaaa', new Date(2026, 9, 1, 8, 0, 0));
    await store.save(file, Buffer.from('new'), 'bbbbbbbb', new Date(2026, 9, 21, 8, 0, 0));
    expect(refs()).toEqual(['refs/easyview/ai-backups/2026-10-21_08-00-00_bbbbbbbb']);
    const outside = path.join(root, 'plain.xlsx'); await writeFile(outside, 'plain');
    for (const [index, id] of ['c1', 'c2', 'c3'].entries()) await store.save(outside, Buffer.from(id), id, new Date(2026, 9, 21, 8, index));
    expect((await readdir(appData)).sort()).toEqual(['2026-10-21_08-01-00_c2', '2026-10-21_08-02-00_c3']);
  });
});
