import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context, runtimeRoot } from './runtime.mjs';
import { contentHash, DocumentProvider } from '../src/host/documents.ts';
import { DraftStore } from '../src/host/draft-store.ts';
import { installDraftRoutes } from '../src/host/draft-routes.ts';
import { hashContent } from '@easyview/editor-sync';
import { OperationJournal } from '../src/host/operation-journal.ts';

test('binary routes keep idempotent ACKs, reject stale generations, bound bytes and preserve baseline conflicts', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-draft-routes-'));
  const workspace = resolve(home, 'workspace'); await mkdir(workspace);
  await writeFile(resolve(workspace, 'sample.docx'), 'original');
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context(); const plugin = ctx.plugin(LocalFileSystem, { cwd: workspace }); await plugin.await();
  const provider = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: workspace }], 1024);
  const store = await DraftStore.open(resolve(home, 'data')); const routes = new Map(); let disposed = false;
  installDraftRoutes({ register(route) { routes.set(route.path.split('/').at(-1), route); }, documents: provider, store,
    maxBytes: 16, maxPending: 1, isDisposed: () => disposed });
  const workbenchId = randomUUID();
  const call = (name, query = {}, init = {}) => routes.get(name).fetch(new Request(`http://dsh/api/easyview/v1/${name}?${new URLSearchParams(query)}`, init));
  const attach = async (documentId, generation) => (await call('draft-attach', {}, { method: 'POST', body: JSON.stringify({ documentId, generation, workbenchId }) })).json();
  try {
    const document = await provider.open('w', 'sample.docx'); let generation = randomUUID();
    assert.equal((await attach(document.sessionId, generation)).value.record, null);
    const query = { documentId: document.sessionId, workbenchId, generation };
    const metadata = { requestId: randomUUID(), editorRevision: 1, expectedCheckpointRevision: 0, sourceDiskHash: document.diskHash, format: 'docx' };
    const checkpoint = (meta = metadata, body = 'draft', q = query) => call('checkpoint', q, { method: 'POST', headers: { 'x-easyview-draft': JSON.stringify(meta) }, body });
    const first = await (await checkpoint()).json(); assert.equal(first.value.checkpointRevision, 1);
    assert.deepEqual(await (await checkpoint()).json(), first);
    assert.equal((await checkpoint(metadata, 'different')).status, 409);
    assert.equal((await checkpoint({ ...metadata, requestId: randomUUID() }, 'x'.repeat(17))).status, 409);
    generation = randomUUID(); assert.equal((await attach(document.sessionId, generation)).value.record.checkpointRevision, 1);
    assert.equal((await checkpoint({ ...metadata, requestId: randomUUID(), expectedCheckpointRevision: 1 })).status, 409);
    const recovered = await call('draft-content', { ...query, generation }); assert.equal(await recovered.text(), 'draft');
    await writeFile(resolve(workspace, 'sample.docx'), 'external');
    const reopened = await provider.open('w', 'sample.docx'); generation = randomUUID();
    const conflict = await attach(reopened.sessionId, generation); assert.equal(conflict.value.conflict, true);
    assert.equal((await checkpoint({ ...metadata, requestId: randomUUID(), sourceDiskHash: reopened.diskHash, expectedCheckpointRevision: 1 }, 'overwrite',
      { documentId: reopened.sessionId, workbenchId, generation })).status, 409);
    assert.equal(await (await call('draft-content', { documentId: reopened.sessionId, workbenchId, generation })).text(), 'draft');
    disposed = true; assert.equal((await call('draft-content', { ...query, generation })).status, 409);
  } finally { provider.dispose(); await store.close(); await plugin.dispose(); }
});

test('authorized binary save rebases durable drafts and an ACK retry never saves newer input as an older revision', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-save-route-')); await writeFile(resolve(home, 'sample.docx'), 'before');
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context(); const plugin = ctx.plugin(LocalFileSystem, { cwd: home }); await plugin.await();
  const provider = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: home }], 4096);
  const store = await DraftStore.open(resolve(home, 'data')), journal = new OperationJournal(resolve(home, 'data'), store, provider);
  const routes = new Map(); installDraftRoutes({ register(route) { routes.set(route.path.split('/').at(-1), route); }, documents: provider, store, journal, maxBytes: 4096, maxPending: 2, isDisposed: () => false });
  const opened = await provider.open('w', 'sample.docx'); const workbenchId = randomUUID(), generation = randomUUID();
  const query = new URLSearchParams({ documentId: opened.sessionId, workbenchId, generation });
  const call = (name, headers, body) => routes.get(name).fetch(new Request(`http://dsh/api/easyview/v1/${name}?${query}`, { method: 'POST', headers, body }));
  const saveMetadata = { requestId: randomUUID(), editorRevision: 1, sourceDiskHash: opened.diskHash, format: 'docx' };
  try {
    await call('draft-attach', {}, JSON.stringify({ documentId: opened.sessionId, workbenchId, generation }));
    const checkpoint = await call('checkpoint', { 'x-easyview-draft': JSON.stringify({ ...saveMetadata, expectedCheckpointRevision: 0 }) }, 'after'); assert.equal(checkpoint.status, 200);
    const first = await (await call('save', { 'x-easyview-save': JSON.stringify(saveMetadata) }, 'after')).json(); assert.equal(first.ok, true);
    assert.equal(new TextDecoder().decode(await provider.read(opened.sessionId)), 'after');
    const identity = await provider.draftIdentity(opened.sessionId); const key = contentHash(Buffer.from(`${workbenchId}\0${identity.fileIdentity}`));
    assert.equal(store.load(key).sourceDiskHash, first.value.diskHash); assert.equal(store.load(key).savedEditorRevision, 1);
    const newer = await call('checkpoint', { 'x-easyview-draft': JSON.stringify({ requestId: randomUUID(), editorRevision: 2, expectedCheckpointRevision: 1, format: 'docx', sourceDiskHash: first.value.diskHash }) }, 'newer');
    assert.equal(newer.status, 200); assert.deepEqual(await (await call('save', { 'x-easyview-save': JSON.stringify(saveMetadata) }, 'after')).json(), first);
    assert.equal(first.value.savedEditorRevision, 1); assert.equal(store.load(key).editorRevision, 2); assert.equal(store.load(key).savedEditorRevision, undefined);
    assert.equal(new TextDecoder().decode(await provider.read(opened.sessionId)), 'after');
  } finally { await journal.close(); await store.close(); provider.dispose(); await plugin.dispose(); }
});

test('original text protocol ACKs a durable canonical patch and retries a lost ACK exactly once', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-text-routes-'));
  await writeFile(resolve(home, 'note.md'), '# 原始\r\nkeep');
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context(); const plugin = ctx.plugin(LocalFileSystem, { cwd: home }); await plugin.await();
  const provider = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: home }], 4096);
  const store = await DraftStore.open(resolve(home, 'data')); const routes = new Map();
  installDraftRoutes({ register(route) { routes.set(route.path.split('/').at(-1), route); }, documents: provider, store, maxBytes: 4096, maxPending: 2, isDisposed: () => false });
  const workbenchId = randomUUID(), generation = randomUUID();
  const document = await provider.open('w', 'note.md'); const query = new URLSearchParams({ documentId: document.sessionId, workbenchId, generation });
  const call = (name, body) => routes.get(name).fetch(new Request(`http://dsh/api/easyview/v1/${name}?${query}`, body ? { method: 'POST', body: JSON.stringify(body) } : {}));
  try {
    assert.equal((await call('draft-attach', { documentId: document.sessionId, workbenchId, generation })).status, 200);
    assert.equal((await (await call('text-snapshot')).json()).value.content, '# 原始\nkeep');
    const next = '# 修改\nkeep'; const edit = { clientEditId: `${document.sessionId}:1`, baseRevision: 0, edits: [{ from: 2, to: 4, insert: '修改' }], resultHash: hashContent(next) };
    const first = await (await call('text-edits', edit)).json(); assert.equal(first.value.revision, 1);
    assert.deepEqual(await (await call('text-edits', edit)).json(), first);
    assert.equal((await call('text-edits', { ...edit, resultHash: hashContent('other') })).status, 409);
    assert.equal((await (await call('text-snapshot')).json()).value.content, next);
    assert.equal(new TextDecoder().decode(await provider.read(document.sessionId)), '# 原始\r\nkeep');
    const identity = await provider.draftIdentity(document.sessionId);
    const key = contentHash(Buffer.from(`${workbenchId}\0${identity.fileIdentity}`));
    await store.close(); const reopened = await DraftStore.open(resolve(home, 'data'));
    try { const record = reopened.load(key); assert.equal(record.checkpointRevision, 1);
      assert.equal(new TextDecoder().decode(await reopened.bytes(record)), next); } finally { await reopened.close(); }
  } finally { provider.dispose(); await store.close(); await plugin.dispose(); }
});
