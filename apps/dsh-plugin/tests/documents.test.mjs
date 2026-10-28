import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context, runtimeRoot } from './runtime.mjs';
import { DocumentProvider, workspacePath } from '../src/host/documents.ts';

test('authorized real DSH filesystem reads reject traversal, junction escape, stale originals and revoked workspaces', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-authorize-'));
  const inside = resolve(home, 'workspace'); const outside = resolve(home, 'outside');
  await mkdir(inside); await mkdir(outside);
  await writeFile(resolve(inside, 'note.md'), '# original');
  await writeFile(resolve(outside, 'secret.md'), 'must remain outside');
  await symlink(outside, resolve(inside, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context();
  const plugin = ctx.plugin(LocalFileSystem, { cwd: inside });
  await plugin.await();
  let workspaces = [{ id: 'authorized', title: 'fixture', path: inside }];
  const provider = new DocumentProvider(() => ctx.get('fs'), () => workspaces, 1024);
  try {
    for (const path of ['../outside/secret.md', '/absolute', 'C:/outside', 'escape\\secret.md', 'note.md:stream', './note.md']) {
      assert.throws(() => workspacePath(path), { code: 'INVALID_ARGUMENT' });
    }
    assert.deepEqual((await provider.list('authorized', '')).map(entry => entry.name), ['note.md']);
    await assert.rejects(provider.open('forged', 'note.md'), { code: 'PERMISSION_DENIED' });
    await assert.rejects(provider.open('authorized', 'escape/secret.md'), { code: 'PERMISSION_DENIED' });
    await assert.rejects(provider.creationTarget('authorized', 'escape/new.md'), { code: 'PERMISSION_DENIED' });
    await assert.rejects(provider.creationTarget('authorized', 'con.md'), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(provider.creationTarget('authorized', 'new.xlsx'), { code: 'INVALID_ARGUMENT' });
    const created = await provider.creationTarget('authorized', 'created.md');
    assert.equal(await provider.inspectReference(created), null);
    await provider.createReference(created, Buffer.from('# created'));
    await assert.rejects(provider.createReference(created, Buffer.from('# overwrite')), { code: 'CONFLICT' });
    assert.equal(await readFile(resolve(inside, 'created.md'), 'utf8'), '# created');
    const document = await provider.open('authorized', 'note.md');
    assert.equal(new TextDecoder().decode(await provider.read(document.sessionId)), '# original');
    await writeFile(resolve(inside, 'note.md'), '# external edit');
    await assert.rejects(provider.read(document.sessionId), { code: 'CONFLICT' });
    workspaces = [];
    await assert.rejects(provider.read(document.sessionId), { code: 'PERMISSION_DENIED' });
  } finally { provider.dispose(); await plugin.dispose(); }
});
