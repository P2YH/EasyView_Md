import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DraftStore } from '../src/host/draft-store.ts';
import { OperationJournal } from '../src/host/operation-journal.ts';
import { replaceLocalBytes, createLocalBytes } from '../src/host/local-byte-writer.ts';
import { contentHash } from '../src/host/documents.ts';

const target = { workspaceId: 'fixture', relativePath: 'original.txt', fileIdentity: 'one-file' };
function provider(directory, beforeReplace = async () => {}) {
  const path = resolve(directory, 'original.txt');
  return { readReference: () => readFile(path),
    inspectReference: async () => { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    createReference: (_target, bytes) => createLocalBytes(path, bytes, async () => {}),
    replaceReference: (_target, bytes, baseHash) => replaceLocalBytes(path, bytes, async () => {
      await beforeReplace(); assert.equal(contentHash(await readFile(path)), baseHash, 'external change');
    }) };
}
const save = () => ({ requestId: 'save-request', target, baseHash: contentHash(Buffer.from('before')), bytes: Buffer.from('after'), editorRevision: 1 });

test('new files have durable idempotent receipts, are never overwritten and cannot be deleted by undo', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-create-'));
  const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory));
  const input = { requestId: 'create-request', target, bytes: Buffer.from('new document') };
  try {
    const operation = await journal.create(input); assert.equal(operation.state, 'committed'); assert.equal(operation.kind, 'create');
    assert.deepEqual(await journal.create(input), operation);
    await assert.rejects(journal.create({ ...input, bytes: Buffer.from('other') }), { code: 'CONFLICT' });
    await assert.rejects(journal.create({ ...input, requestId: 'another-request' }), { code: 'CONFLICT' });
    await assert.rejects(journal.undo(operation.operationId, 'undo-create'), { code: 'CONFLICT' });
    await assert.rejects(createLocalBytes(resolve(directory, 'original.txt'), Buffer.from('race overwrite'), async () => {}));
    assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), 'new document');
  } finally { await journal.close(); await store.close(); }
});

for (const point of ['F02', 'F03']) test(`new file ${point}: kill and reconcile without publishing again`, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-create-kill-'));
  const child = fork(new URL('./fixtures/commit-child.mjs', import.meta.url), [directory, point, 'create'], { execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    await once(child, 'message'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory));
    try {
      await journal.recover(); const [record] = journal.list();
      assert.equal(record.state, point === 'F02' ? 'not_applied' : 'committed');
      const content = await provider(directory).inspectReference();
      assert.equal(content === null ? null : content.toString(), point === 'F02' ? null : 'after');
      assert.equal((await journal.create({ requestId: 'save-request', target, bytes: Buffer.from('after') })).operationId, record.operationId);
      if (point === 'F02') assert.equal(await provider(directory).inspectReference(), null);
    } finally { await journal.close(); await store.close(); }
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('real byte replacement has immutable receipts, serialized writers and idempotent guarded undo', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-commit-')); await writeFile(resolve(directory, 'original.txt'), 'before');
  const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory));
  try {
    const operation = await journal.save(save()); assert.equal(operation.state, 'committed');
    assert.deepEqual(await journal.save(save()), operation);
    await assert.rejects(journal.save({ ...save(), bytes: Buffer.from('different') }), { code: 'CONFLICT' });
    const undone = await journal.undo(operation.operationId, 'undo-request'); assert.equal(undone.state, 'committed');
    assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), 'before');
    assert.deepEqual(await journal.undo(operation.operationId, 'other-request'), undone);
    await writeFile(resolve(directory, 'original.txt'), 'someone else');
    await assert.rejects(journal.save({ ...save(), requestId: 'new-request' }), { code: 'CONFLICT' });
    assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), 'someone else');
  } finally { await journal.close(); await store.close(); }
});

test('F06 rechecks the baseline immediately before publication and never overwrites an external edit', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-conflict-')); const path = resolve(directory, 'original.txt'); await writeFile(path, 'before');
  const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory, () => writeFile(path, 'external')));
  try { const operation = await journal.save(save()); assert.equal(operation.state, 'conflict'); assert.equal(await readFile(path, 'utf8'), 'external'); }
  finally { await journal.close(); await store.close(); }
});

for (const point of ['F01', 'F02', 'F03', 'F04']) test(`${point}: actual process kill then read-only recovery`, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), `easyview-${point}-`)); await writeFile(resolve(directory, 'original.txt'), 'before');
  const child = fork(new URL('./fixtures/commit-child.mjs', import.meta.url), [directory, point, 'save'], { execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    const [message] = await once(child, 'message'); assert.equal(message.point, point);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory));
    try {
      await journal.recover(); const records = journal.list();
      if (point === 'F01') assert.equal(records.length, 0);
      else assert.equal(records[0].state, point === 'F02' ? 'not_applied' : 'committed');
      assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), ['F01', 'F02'].includes(point) ? 'before' : 'after');
      if (['F03', 'F04'].includes(point)) assert.equal((await journal.save(save())).operationId, message.operationId);
    } finally { await journal.close(); await store.close(); }
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

for (const point of ['F02', 'F03']) test(`F07 undo: kill at ${point}, reconcile once and retain later edits`, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-undo-kill-')); await writeFile(resolve(directory, 'original.txt'), 'before');
  const child = fork(new URL('./fixtures/commit-child.mjs', import.meta.url), [directory, point, 'undo'], { execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    await once(child, 'message'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const store = await DraftStore.open(directory), journal = new OperationJournal(directory, store, provider(directory));
    try { await journal.recover(); const records = journal.list(); assert.equal(records.length, 2);
      assert.equal(records[1].state, point === 'F02' ? 'not_applied' : 'committed');
      await writeFile(resolve(directory, 'original.txt'), 'later edit');
      assert.equal((await journal.undo(records[0].operationId, 'repeat-undo')).operationId, records[1].operationId);
      assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), 'later edit');
    } finally { await journal.close(); await store.close(); }
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('F05 damaged candidate isolates a prepared operation as unknown and blocks later writes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-damaged-')); await writeFile(resolve(directory, 'original.txt'), 'before');
  const store = await DraftStore.open(directory); const journal = new OperationJournal(directory, store, provider(directory), async point => { if (point === 'F02') throw new Error('stop before replacement'); });
  await assert.rejects(journal.save(save())); const operation = journal.list()[0]; await journal.close();
  await writeFile(resolve(directory, 'blobs', operation.candidate), 'damaged');
  const reopened = new OperationJournal(directory, store, provider(directory));
  try { await reopened.recover(); assert.equal(reopened.get(operation.operationId).state, 'unknown');
    await assert.rejects(reopened.save({ ...save(), requestId: 'unsafe-retry' }), { code: 'CONFLICT' });
    assert.equal(await readFile(resolve(directory, 'original.txt'), 'utf8'), 'before');
  } finally { await reopened.close(); await store.close(); }
});
