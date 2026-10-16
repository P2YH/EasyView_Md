import { execFile } from 'node:child_process';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { GuardRepository, GuardFile, GuardStatus, GuardHistory, GuardComparison, GuardRequest, GuardBranch } from '@easyview/contracts';

// One limiter per host process, shared across windows and repositories.
const waiting: Array<() => void> = [];
let running = 0;
export const guardDiagnostics = { commands: 0, active: 0, peak: 0, scans: 0 };
async function slot<T>(operation: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  guardDiagnostics.active++; guardDiagnostics.peak = Math.max(guardDiagnostics.peak, guardDiagnostics.active);
  try { return await operation(); }
  finally { guardDiagnostics.active--; const next = waiting.shift(); if (next) next(); else running--; }
}
const writes = new Map<string, Promise<unknown>>();
function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined); writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}
export function guardGit(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  return slot(() => new Promise((resolve, reject) => {
    signal?.throwIfAborted(); guardDiagnostics.commands++;
    execFile('git', ['--no-optional-locks', '-C', root, ...args], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' },
    }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout));
  }));
}
const inside = (root: string, file: string): boolean => { const relative = path.relative(root, file); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export interface GuardHost {
  roots(): string[];
  discovered?(repositories: GuardRepository[], warnings: string[]): void;
  beforeStage(files: string[]): Promise<void>;
  discard(files: string[], action: () => Promise<void>): Promise<boolean>;
  trash(file: string): Promise<void>;
}
export class VersionGuardService {
  private repositories = new Map<string, GuardRepository>();
  private controller = new AbortController();
  private queries = new Map<string, Promise<unknown>>();
  private watchers: FSWatcher[] = [];
  private checked = new Map<string, number>();
  private active = false;
  private watchGeneration = 0;
  private changed?: (paths: string[] | null) => void;
  constructor(private readonly host: GuardHost) {}
  setActive(active: boolean, changed?: (paths: string[] | null) => void): void {
    this.watchGeneration++; this.active = active; this.changed = changed;
    this.watchers.splice(0).forEach(watcher => watcher.close());
    if (active) void this.watchMetadata();
  }
  private async watchMetadata(): Promise<void> {
    const generation = this.controller; const watchGeneration = this.watchGeneration; const watched = new Set<string>();
    for (const repository of this.repositories.values()) {
      try {
        const output = await guardGit(repository.rootPath, ['rev-parse', '--absolute-git-dir', '--git-common-dir'], generation.signal);
        if (!this.active || generation !== this.controller || watchGeneration !== this.watchGeneration) return;
        for (const directory of new Set(output.trim().split('\n').map(value => path.resolve(repository.rootPath, value)))) {
          if (watched.has(directory)) continue; watched.add(directory);
          const watcher = watch(directory, (_event, name) => {
            if (name && /^(objects|logs)(\/|$)/.test(String(name))) return;
            this.changed?.(null);
          });
          watcher.on('error', () => this.changed?.([repository.rootPath])); this.watchers.push(watcher);
          // refs are tiny and must also catch remote updates and external branch changes.
          try { const refs = watch(path.join(directory, 'refs'), { recursive: true }, () => this.changed?.([repository.rootPath])); refs.on('error', () => this.changed?.([repository.rootPath])); this.watchers.push(refs); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      } catch { if (!generation.signal.aborted) this.changed?.(null); }
    }
  }
  dispose(): void { this.active = false; this.controller.abort(); this.watchers.splice(0).forEach(w => w.close()); this.queries.clear(); }
  async discover(): Promise<GuardRepository[]> {
    this.controller.abort(); this.controller = new AbortController();
    const signal = this.controller.signal;
    this.watchers.splice(0).forEach(w => w.close()); guardDiagnostics.scans++;
    const found = new Map<string, GuardRepository>(); const visited = new Set<string>(); const warnings: string[] = [];
    this.repositories = found;
    const roots = await Promise.all(this.host.roots().map(root => fs.realpath(root)));
    const queue = [...roots];
    while (queue.length) {
      signal.throwIfAborted(); const directory = queue.shift()!;
      if (visited.has(directory)) continue; visited.add(directory);
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { warnings.push(`${directory}: ${String(error)}`); this.host.discovered?.([...found.values()], [...warnings]); continue; }
      if (entries.some(entry => entry.name === '.git')) {
        try {
          const rootPath = await fs.realpath((await guardGit(directory, ['rev-parse', '--show-toplevel'], signal)).trim());
          if (roots.some(root => inside(root, rootPath))) { found.set(rootPath, { id: rootPath, rootPath, name: path.basename(rootPath) }); this.host.discovered?.([...found.values()], [...warnings]); }
        } catch (error) { signal.throwIfAborted(); warnings.push(`${directory}: ${String(error)}`); this.host.discovered?.([...found.values()], [...warnings]); }
      }
      for (const entry of entries) if (entry.isDirectory() && entry.name !== '.git') queue.push(path.join(directory, entry.name));
      // Yield to IPC/file events even for very large directory trees.
      if (visited.size % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    signal.throwIfAborted(); this.repositories = found;
    if (this.active) await this.watchMetadata();
    return [...found.values()].sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  }
  async repository(id: unknown): Promise<GuardRepository> {
    if (typeof id !== 'string' || !this.repositories.has(id)) throw new Error('Unknown repository. Refresh Version Guard.');
    const repository = this.repositories.get(id)!;
    const roots = await Promise.all(this.host.roots().map(root => fs.realpath(root)));
    const real = await fs.realpath(repository.rootPath);
    if (real !== repository.rootPath || !roots.some(root => inside(root, real))) throw new Error('Repository is outside the open workspace.');
    return repository;
  }
  async files(repository: GuardRepository, paths: unknown): Promise<string[]> {
    if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p || path.isAbsolute(p) || p.includes('\0') || p.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git'))) throw new Error('Invalid file selection.');
    for (const relative of paths as string[]) {
      const file = path.resolve(repository.rootPath, relative);
      if (!inside(repository.rootPath, file) || file === repository.rootPath) throw new Error('File is outside repository.');
      let ancestor = path.dirname(file);
      while (true) {
        try { if (!inside(repository.rootPath, await fs.realpath(ancestor))) throw new Error('File is outside repository.'); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
      }
      const owner = [...this.repositories.values()].filter(repo => inside(repo.rootPath, file)).sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
      if (owner && owner.id !== repository.id && file !== owner.rootPath) throw new Error('Select this file in its own repository.');
    }
    return paths as string[];
  }
  async status(repository: GuardRepository): Promise<GuardStatus> {
    const output = await guardGit(repository.rootPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=none'], this.controller.signal);
    const status: GuardStatus = { files: [], branch: '', head: '', ahead: 0, behind: 0, checkedAt: this.checked.get(repository.id) };
    const tokens = output.split('\0');
    for (let i = 0; i < tokens.length; i++) {
      const line = tokens[i];
      if (line.startsWith('# branch.head ')) status.branch = line.slice(14);
      else if (line.startsWith('# branch.oid ')) status.head = line.slice(13);
      else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18);
      else if (line.startsWith('# branch.ab ')) { const counts = line.slice(12).split(' '); status.ahead = Number(counts[0]); status.behind = -Number(counts[1]); }
      else if (line.startsWith('? ')) status.files.push({ path: line.slice(2), index: '?', worktree: '?', submodule: false });
      else if (/^[12u] /.test(line)) {
        const count = line[0] === '1' ? 8 : line[0] === '2' ? 9 : 10;
        const fields = line.split(' '); const file: GuardFile = { path: fields.slice(count).join(' '), index: fields[1][0], worktree: fields[1][1], submodule: fields[2][0] === 'S' };
        if (line[0] === '2') file.oldPath = tokens[++i];
        if (line[0] === 'u') { file.index = 'U'; file.worktree = 'U'; }
        status.files.push(file);
      }
    }
    return status;
  }
  async handle(request: GuardRequest): Promise<unknown> {
    if (!request || typeof request !== 'object') throw new Error('Invalid Version Guard request.');
    if (request.method === 'cancel') { this.controller.abort(); this.controller = new AbortController(); return true; }
    if (request.method === 'diagnostics') return { ...guardDiagnostics, watchers: this.watchers.length };
    if (request.method === 'discover') return this.discover();
    const repository = await this.repository(request.repository);
    const root = repository.rootPath;
    const read = async (): Promise<unknown> => {
      if (request.method === 'status') return this.status(repository);
      if (request.method === 'history') {
        if (request.cursor && !/^\d+$/.test(request.cursor)) throw new Error('Invalid history cursor.');
        const status = await this.status(repository);
        if (status.head === '(initial)') return { entries: [] };
        const offset = Number(request.cursor ?? 0);
        const output = await guardGit(root, ['log', 'HEAD', '--date-order', '--max-count=51', `--skip=${offset}`, '--format=%H%x00%P%x00%an%x00%ct%x00%B%x00']);
        const fields = output.split('\0'); const entries: GuardHistory['entries'] = [];
        for (let i = 0; i + 4 < fields.length; i += 5) entries.push({ hash: fields[i].trim(), parents: fields[i + 1].split(' ').filter(Boolean), author: fields[i + 2], timestamp: Number(fields[i + 3]) * 1000, message: fields[i + 4].trim() });
        return { entries: entries.slice(0, 50), cursor: entries.length > 50 ? String(offset + 50) : undefined } satisfies GuardHistory;
      }
      if (request.method === 'commitFiles') {
        const revision = this.revision(request.revision);
        const output = await guardGit(root, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', ...(await this.parent(root, revision) ? [`${revision}^1`, revision] : [revision])]);
        const tokens = output.split('\0'); const files: GuardFile[] = [];
        for (let i = 0; i + 1 < tokens.length;) { const status = tokens[i++]; const old = tokens[i++]; const renamed = /^[RC]/.test(status); files.push({ path: renamed ? tokens[i++] : old, oldPath: renamed ? old : undefined, index: status[0], worktree: '.', submodule: false }); }
        return files;
      }
      if (request.method === 'comparison') return this.comparison(repository, request);
      if (request.method === 'branches') return this.branches(root);
      throw new Error('Unsupported Version Guard request.');
    };
    if (['status', 'history', 'commitFiles', 'comparison', 'branches'].includes(request.method)) {
      const key = JSON.stringify(request); const existing = this.queries.get(key); if (existing) return existing;
      const promise = read(); this.queries.set(key, promise); try { return await promise; } finally { if (this.queries.get(key) === promise) this.queries.delete(key); }
    }
    return serial(root, async () => {
      if (request.method === 'checkout') {
        const name = typeof request.branch === 'string' ? request.branch.trim() : '';
        if (!name) throw new Error('Branch name is required.');
        if ((await this.status(repository)).files.some(file => file.index === 'U')) throw new Error('Resolve conflicts before switching branches.');
        if (request.create) { await guardGit(root, ['check-ref-format', '--branch', name]).catch(() => { throw new Error(`Invalid branch name: ${name}`); }); return guardGit(root, ['switch', '-c', name]); }
        const refs = new Set((await guardGit(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])).split('\n').filter(Boolean));
        if (refs.has(`refs/heads/${name}`)) return guardGit(root, ['switch', name]);
        if (!refs.has(`refs/remotes/${name}`)) throw new Error(`Unknown branch: ${name}`);
        const remotes = (await guardGit(root, ['remote'])).split('\n').filter(Boolean).sort((a, b) => b.length - a.length);
        const remote = remotes.find(each => name.startsWith(`${each}/`));
        const local = remote ? name.slice(remote.length + 1) : name;
        return guardGit(root, refs.has(`refs/heads/${local}`) ? ['switch', local] : ['switch', '--track', name]);
      }
      if (request.method === 'commit') {
        if (typeof request.message !== 'string' || !request.message.trim()) throw new Error('Commit message is required.');
        const status = await this.status(repository);
        if (status.files.some(file => file.index === 'U')) throw new Error('Resolve conflicts before committing.');
        if (!status.files.some(file => file.index !== '.' && file.index !== '?')) {
          const paths = request.stageAll ? status.files.filter(file => file.worktree !== '.').flatMap(file => file.oldPath ? [file.oldPath, file.path] : [file.path]) : [];
          if (!paths.length) throw new Error('No staged changes.');
          await this.host.beforeStage(paths.map(file => path.join(root, file)));
          await guardGit(root, ['add', '--', ...paths]);
        }
        return guardGit(root, ['commit', '-m', request.message]);
      }
      if (request.method === 'fetch' || request.method === 'pull' || request.method === 'push' || request.method === 'sync') {
        const status = await this.status(repository);
        if (!status.upstream) throw new Error('No upstream configured for the current branch.');
        const remote = (await guardGit(root, ['config', '--get', `branch.${status.branch}.remote`])).trim();
        const merge = (await guardGit(root, ['config', '--get', `branch.${status.branch}.merge`])).trim();
        if (!remote || !merge) throw new Error('No upstream configured for the current branch.');
        const push = () => guardGit(root, ['push', '--', remote, `HEAD:${merge}`]);
        if (request.method === 'push') return push();
        if (request.method === 'fetch') { const result = await guardGit(root, ['fetch', '--', remote]); this.checked.set(repository.id, Date.now()); return result; }
        if (status.files.some(file => file.index === 'U')) throw new Error('Resolve conflicts before pulling.');
        const result = await this.pull(root);
        this.checked.set(repository.id, Date.now());
        if (request.method === 'sync' && (await this.status(repository)).ahead > 0) return push();
        return result;
      }
      const paths = await this.files(repository, request.paths);
      if (request.method === 'stage') { await this.host.beforeStage(paths.map(file => path.join(root, file))); return guardGit(root, ['add', '--', ...paths]); }
      if (request.method === 'unstage') {
        const status = await this.status(repository);
        return guardGit(root, status.head === '(initial)' ? ['rm', '--cached', '--', ...paths] : ['restore', '--staged', '--', ...paths]);
      }
      if (request.method === 'discard') {
        const status = await this.status(repository);
        const files = paths.map(file => { const item = status.files.find(entry => entry.path === file); if (!item || item.submodule || item.index === 'U') throw new Error('This change cannot be discarded here.'); return item; });
        const fingerprint = async () => Promise.all(paths.map(async file => { try { const stat = await fs.lstat(path.join(root, file)); return stat.isSymbolicLink() ? `link:${await fs.readlink(path.join(root, file))}` : digest(await fs.readFile(path.join(root, file))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error; } }));
        const before = await fingerprint();
        return this.host.discard(paths.map(file => path.join(root, file)), async () => {
          if (JSON.stringify(before) !== JSON.stringify(await fingerprint()) || JSON.stringify(status.files) !== JSON.stringify((await this.status(repository)).files)) throw new Error('Files changed while confirming. Review and try again.');
          for (const file of files) {
            if (file.index === '?') await this.host.trash(path.join(root, file.path));
            else await guardGit(root, ['restore', '--worktree', '--', file.path]);
          }
        });
      }
      throw new Error('Unsupported Version Guard operation.');
    });
  }
  private async branches(root: string): Promise<GuardBranch[]> {
    const output = await guardGit(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(authorname)%00%(committerdate:unix)%00%(contents:subject)', 'refs/heads', 'refs/remotes'], this.controller.signal);
    const branches: GuardBranch[] = [];
    for (const line of output.split('\n')) {
      const [ref, name, head, upstream, track, author, time, subject] = line.split('\0');
      if (!ref || ref.endsWith('/HEAD')) continue;
      const ahead = /ahead (\d+)/.exec(track ?? '')?.[1]; const behind = /behind (\d+)/.exec(track ?? '')?.[1];
      branches.push({ name, remote: ref.startsWith('refs/remotes/'), current: head === '*', upstream: upstream || undefined, ahead: upstream ? Number(ahead ?? 0) : undefined, behind: upstream ? Number(behind ?? 0) : undefined, subject: subject ?? '', author: author ?? '', timestamp: Number(time) * 1000 });
    }
    return branches;
  }
  private async pull(root: string): Promise<string> {
    const config = async (key: string) => (await guardGit(root, ['config', '--get', key]).catch(() => '')).trim();
    // Without pull.rebase/pull.ff, Git refuses divergent pulls; merge like VS Code does by default.
    const strategy = await config('pull.rebase') || await config('pull.ff') ? [] : ['--no-rebase'];
    try { return await guardGit(root, ['pull', ...strategy]); }
    catch (error) {
      const rebasing = await Promise.all(['rebase-merge', 'rebase-apply'].map(async name => {
        const dir = (await guardGit(root, ['rev-parse', '--git-path', name])).trim();
        return fs.access(path.resolve(root, dir)).then(() => true, () => false);
      }));
      // A half-finished rebase cannot be continued from the panel, so restore the pre-pull state.
      if (rebasing.some(Boolean)) await guardGit(root, ['rebase', '--abort']).catch(() => undefined);
      throw error;
    }
  }
  private revision(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/.test(value)) throw new Error('Invalid commit.'); return value; }
  private async parent(root: string, revision: string): Promise<string | undefined> { return (await guardGit(root, ['rev-list', '--parents', '-n', '1', revision])).trim().split(' ')[1]; }
  private async blob(root: string, spec: string): Promise<string> {
    const size = Number((await guardGit(root, ['cat-file', '-s', spec])).trim());
    if (size > 2 * 1024 * 1024) throw new Error('File exceeds the 2 MiB comparison limit.');
    return guardGit(root, ['show', spec]);
  }
  private async comparison(repository: GuardRepository, request: GuardRequest): Promise<GuardComparison> {
    const [file] = await this.files(repository, request.paths); const root = repository.rootPath;
    let base = '', content = '', baseLabel = '', contentLabel = '';
    if (request.source === 'commit') {
      const revision = this.revision(request.revision); const parent = await this.parent(root, revision);
      const files = await this.handle({ method: 'commitFiles', repository: root, revision }) as GuardFile[];
      const entry = files.find(entry => entry.path === file); if (!entry) throw new Error('File is not part of this commit.');
      baseLabel = parent ? `${parent.slice(0, 8)} (first parent)` : 'Empty'; contentLabel = revision.slice(0, 8);
      if (parent && entry.index !== 'A') base = await this.blob(root, `${parent}:${entry.oldPath ?? file}`);
      if (entry.index !== 'D') content = await this.blob(root, `${revision}:${file}`);
    } else {
      const status = await this.status(repository); const entry = status.files.find(entry => entry.path === file); if (!entry || entry.submodule) throw new Error('No text comparison for this entry.');
      if (request.source === 'staged') {
        baseLabel = 'HEAD'; contentLabel = 'Index';
        if (status.head !== '(initial)' && entry.index !== 'A') base = await this.blob(root, `HEAD:${entry.oldPath ?? file}`);
        if (entry.index !== 'D') content = await this.blob(root, `:${file}`);
      } else {
        baseLabel = 'Index'; contentLabel = 'Working tree';
        if (entry.index !== '?') base = await this.blob(root, `:${file}`);
        if (entry.worktree !== 'D') { const target = path.join(root, file); const stat = await fs.lstat(target); if (stat.isSymbolicLink()) content = await fs.readlink(target); else { if (stat.size > 2 * 1024 * 1024) throw new Error('File exceeds the 2 MiB comparison limit.'); content = await fs.readFile(target, 'utf8'); } }
      }
    }
    return { base, content, baseLabel, contentLabel, path: path.join(root, file), key: digest(`${root}:${file}:${baseLabel}:${contentLabel}:${base}:${content}`), binary: base.includes('\0') || content.includes('\0') };
  }
}
