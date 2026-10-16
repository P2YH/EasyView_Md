import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { VersionGuardService, guardDiagnostics } from '../src/git/version-guard';
import type { GuardComparison, GuardFile, GuardHistory } from '@easyview/contracts';
const temps: string[] = []; const services: VersionGuardService[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.dispose()); await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'version-guard-test-'))); temps.push(root);
  const repo = path.join(root, 'repo'); await mkdir(repo); init(repo);
  const service = new VersionGuardService({ roots: () => [root], beforeStage: async () => {}, discard: async (_files, action) => { await action(); return true; }, trash: file => rm(file) }); services.push(service);
  return { root, repo, service };
}
function init(root: string) { git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Guard Test'); git(root, 'config', 'user.email', 'guard@example.test'); }
it('discovers every nested repository, submodule and worktree without including an outside parent or symlink', async () => {
  const { root, repo, service } = await fixture();
  await writeFile(path.join(repo, 'base'), 'base'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const nested = path.join(repo, 'deep', 'nested'); await mkdir(nested, { recursive: true }); init(nested);
  const worktree = path.join(root, 'worktree'); git(repo, 'worktree', 'add', '-q', '-b', 'second', worktree);
  const external = path.join(root, 'external'); await mkdir(external); init(external); await writeFile(path.join(external, 'file'), 'sub'); git(external, 'add', '.'); git(external, 'commit', '-qm', 'sub');
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', external, 'sub');
  await symlink(external, path.join(root, 'alias'));
  const found = await service.discover(); expect(found.map(item => item.rootPath).sort()).toEqual([repo, nested, worktree, external, path.join(repo, 'sub')].sort());
  const below = new VersionGuardService({ roots: () => [path.join(repo, 'deep')], beforeStage: async () => {}, discard: async () => false, trash: async () => {} }); services.push(below);
  expect((await below.discover()).map(item => item.rootPath)).toEqual([nested]);
});
it('keeps index and worktree distinct and commits only staged changes including unusual paths', async () => {
  const { repo, service } = await fixture(); await service.discover();
  const name = '中文 file\nname.txt'; await writeFile(path.join(repo, name), 'one\n'); await writeFile(path.join(repo, 'other'), 'untouched');
  await service.handle({ method: 'stage', repository: repo, paths: [name] });
  await service.handle({ method: 'commit', repository: repo, message: 'initial' });
  expect(git(repo, 'ls-tree', '--name-only', 'HEAD')).not.toContain('other');
});
it('commits staged content, preserves unstaged edits, and unstages before and after first commit', async () => {
  const { repo, service } = await fixture(); await service.discover();
  const name = '中文 file\nname.txt'; await writeFile(path.join(repo, name), 'one\n');
  await service.handle({ method: 'stage', repository: repo, paths: [name] }); await service.handle({ method: 'unstage', repository: repo, paths: [name] });
  expect((await service.status(await service.repository(repo))).files[0].index).toBe('?');
  await service.handle({ method: 'stage', repository: repo, paths: [name] }); await service.handle({ method: 'commit', repository: repo, message: 'initial' });
  await writeFile(path.join(repo, name), 'two\n'); await service.handle({ method: 'stage', repository: repo, paths: [name] }); await writeFile(path.join(repo, name), 'three\n'); await writeFile(path.join(repo, 'other'), 'other');
  const status = await service.status(await service.repository(repo)); expect(status.files.find(file => file.path === name)).toMatchObject({ index: 'M', worktree: 'M' });
  const diff = await service.handle({ method: 'comparison', repository: repo, paths: [name], source: 'working' }) as GuardComparison; expect(diff.base).toBe('two\n'); expect(diff.content).toBe('three\n');
  await service.handle({ method: 'discard', repository: repo, paths: [name] }); expect(await readFile(path.join(repo, name), 'utf8')).toBe('two\n');
  await service.handle({ method: 'commit', repository: repo, message: 'second\n\nbody' }); expect(git(repo, 'show', `HEAD:${name}`)).toBe('two'); expect(git(repo, 'ls-tree', '--name-only', 'HEAD')).not.toContain('other');
  const history = await service.handle({ method: 'history', repository: repo }) as GuardHistory; expect(history.entries).toHaveLength(2); expect(history.entries[0].message).toBe('second\n\nbody');
  const files = await service.handle({ method: 'commitFiles', repository: repo, revision: history.entries[0].hash }) as GuardFile[]; expect(files[0].path).toBe(name);
  const initial = await service.handle({ method: 'comparison', repository: repo, revision: history.entries[1].hash, paths: [name], source: 'commit' }) as GuardComparison; expect(initial.base).toBe(''); expect(initial.content).toBe('one\n');
});
it('fetches and pushes the configured upstream and never performs a background network poll', async () => {
  const { root, repo, service } = await fixture(); const remote = path.join(root, 'remote.git'); git(root, 'init', '--bare', '-q', remote);
  await writeFile(path.join(repo, 'file'), 'base'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base'); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-qu', 'origin', 'HEAD');
  await service.discover(); await writeFile(path.join(repo, 'file'), 'next'); await service.handle({ method: 'stage', repository: repo, paths: ['file'] }); await service.handle({ method: 'commit', repository: repo, message: 'next' });
  expect((await service.status(await service.repository(repo))).ahead).toBe(1); await service.handle({ method: 'push', repository: repo });
  expect((await service.status(await service.repository(repo))).ahead).toBe(0); await service.handle({ method: 'fetch', repository: repo }); expect((await service.status(await service.repository(repo))).checkedAt).toBeTypeOf('number');
  const commands = guardDiagnostics.commands; await new Promise(resolve => setTimeout(resolve, 100)); expect(guardDiagnostics.commands).toBe(commands); expect(guardDiagnostics.peak).toBeLessThanOrEqual(2);
});
it('rejects workspace escapes, nested file ownership and Git metadata paths', async () => {
  const { root, repo, service } = await fixture(); const nested = path.join(repo, 'child'); await mkdir(nested); init(nested); await service.discover();
  await expect(service.handle({ method: 'stage', repository: repo, paths: ['../external'] })).rejects.toThrow('Invalid');
  await expect(service.handle({ method: 'stage', repository: repo, paths: ['.git/config'] })).rejects.toThrow('Invalid');
  await expect(service.handle({ method: 'stage', repository: repo, paths: ['child/file'] })).rejects.toThrow('own repository');
  await symlink(root, path.join(repo, 'escape')); await expect(service.handle({ method: 'stage', repository: repo, paths: ['escape/nope'] })).rejects.toThrow('outside');
});
