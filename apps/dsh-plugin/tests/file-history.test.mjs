import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context, runtimeRoot } from './runtime.mjs';
import { contentHash, DocumentProvider } from '../src/host/documents.ts';
import { DraftStore } from '../src/host/draft-store.ts';
import { OperationJournal } from '../src/host/operation-journal.ts';
import { installDraftRoutes } from '../src/host/draft-routes.ts';

test('authorized history undo survives lost ACK/restart, rejects other files, dirty recovery copies and multiple mounts', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-history-'));
  await writeFile(resolve(home, 'sample.txt'), 'before'); await writeFile(resolve(home, 'other.txt'), 'other');
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context(), plugin = ctx.plugin(LocalFileSystem, { cwd: home }); await plugin.await();
  const provider = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: home }], 4096);
  const data = resolve(home, 'data'); let store = await DraftStore.open(data), journal = new OperationJournal(data, store, provider);
  const routes = new Map(); let drafts;
  const install = () => { routes.clear(); drafts = installDraftRoutes({ register(route) { routes.set(route.path.split('/').at(-1), route); },
    documents: provider, store, journal, maxBytes: 4096, maxPending: 2, isDisposed: () => false }); };
  install();
  const document = await provider.open('w', 'sample.txt'), other = await provider.open('w', 'other.txt');
  const workbenchId = randomUUID(), generation = randomUUID(), query = { documentId: document.sessionId, workbenchId, generation };
  const call = (name, body, q = query) => routes.get(name).fetch(new Request(`http://dsh/api/easyview/v1/${name}?${new URLSearchParams(q)}`,
    body ? { method: 'POST', body: JSON.stringify(body) } : {}));
  const attach = q => call('draft-attach', q, q);
  const requestId = randomUUID(); let original;
  try {
    await attach(query);
    const identity = await provider.draftIdentity(document.sessionId), key = contentHash(Buffer.from(`${workbenchId}\0${identity.fileIdentity}`));
    await store.checkpoint({ key, generation, requestId: randomUUID(), expectedCheckpointRevision: 0,
      format: 'text', sourceDiskHash: identity.diskHash, editorRevision: 1, bytes: Buffer.from('after') });
    original = await journal.save({ requestId: randomUUID(), target: provider.reference(document.sessionId), baseHash: identity.diskHash,
      bytes: Buffer.from('after'), editorRevision: 1, draft: { key, generation } });
    provider.saved(document.sessionId, original.outputHash);
    const undo = { requestId, operationId: original.operationId, editorRevision: 1 };
    assert.equal((await (await call('operations')).json()).value[0].canUndo, true);
    const otherQuery = { documentId: other.sessionId, workbenchId, generation: randomUUID() }; await attach(otherQuery);
    assert.equal((await call('undo', undo, otherQuery)).status, 403);
    assert.equal((await call('undo', { ...undo, editorRevision: 2 })).status, 409);
    const second = await provider.open('w', 'sample.txt'), secondQuery = { documentId: second.sessionId, workbenchId: randomUUID(), generation: randomUUID() };
    await attach(secondQuery);
    assert.equal((await call('undo', undo)).status, 409, 'Two mounted workbenches cannot undo under only one lease');
    const secondKey = contentHash(Buffer.from(`${secondQuery.workbenchId}\0${identity.fileIdentity}`));
    await store.checkpoint({ key: secondKey, generation: secondQuery.generation, requestId: randomUUID(), expectedCheckpointRevision: 0,
      format: 'text', sourceDiskHash: original.outputHash, editorRevision: 1, bytes: Buffer.from('unsaved manual input') });
    drafts.release(second.sessionId);
    assert.equal((await call('undo', undo)).status, 409, 'A closed dirty recovery draft also blocks undo');
    await store.discard(secondKey, secondQuery.generation, 1, randomUUID());
    // A clean Office-style remount has revision zero even though its saved
    // recovery record retains the prior generation's revision.
    query.generation = randomUUID(); await attach(query); undo.editorRevision = 0;
    const result = await (await call('undo', undo)).json(); assert.equal(result.ok, true);
    assert.equal(result.value.undoOf, original.operationId); assert.equal(await readFile(resolve(home, 'sample.txt'), 'utf8'), 'before');
    assert.equal(store.load(key), null, 'Old clean recovery draft is retired');
    assert.deepEqual(await (await call('undo', undo)).json(), result, 'Lost ACK never writes again');
    assert.equal((await (await call('operations')).json()).value.find(item => item.operationId === original.operationId).canUndo, false);
    const undoOperation = journal.get(result.value.operationId);
    // Restart may reconcile receipts, but must not replay an undo over later input.
    await journal.close(); await store.close();
    await writeFile(resolve(home, 'sample.txt'), 'later external edit');
    store = await DraftStore.open(data); journal = new OperationJournal(data, store, provider); await journal.recover(); install();
    await attach(query);
    assert.deepEqual(await (await call('undo', undo)).json(), result);
    assert.equal(await readFile(resolve(home, 'sample.txt'), 'utf8'), 'later external edit');
    assert.deepEqual(journal.get(result.value.operationId), undoOperation);
    assert.equal((await call('undo', { ...undo, operationId: result.value.operationId })).status, 409, 'A request ID cannot target another operation');
  } finally { await journal.close(); await store.close(); provider.dispose(); await plugin.dispose(); }
});

test('a draft arriving during candidate staging prevents undo before prepared', async () => {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-history-admission-'));
  const store = await DraftStore.open(home), target = { workspaceId: 'w', relativePath: 'a.txt', fileIdentity: 'identity' };
  const key = 'draft', generation = randomUUID(); let bytes = Buffer.from('before'), inject = false;
  store.begin(key, generation, target.fileIdentity);
  const journal = new OperationJournal(home, store, {
    readReference: async () => bytes, replaceReference: async (_target, next) => { bytes = next; },
  }, async point => { if (inject && point === 'F01') await store.checkpoint({ key, generation, requestId: randomUUID(), expectedCheckpointRevision: 0,
    format: 'text', sourceDiskHash: contentHash(bytes), editorRevision: 1, bytes: Buffer.from('late input') }); });
  try {
    const original = await journal.save({ requestId: randomUUID(), target, baseHash: contentHash(bytes), bytes: Buffer.from('after'), editorRevision: 0 });
    inject = true;
    await assert.rejects(journal.undo(original.operationId, randomUUID(), { admit: () => store.assertFileClean(target.fileIdentity) }), { code: 'CONFLICT' });
    assert.equal(new TextDecoder().decode(bytes), 'after'); assert.equal(journal.list().length, 1);
    assert.equal(new TextDecoder().decode(await store.bytes(store.load(key))), 'late input');
  } finally { await journal.close(); await store.close(); }
});
