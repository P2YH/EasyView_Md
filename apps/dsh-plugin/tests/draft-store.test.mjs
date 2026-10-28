import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DraftStore } from '../src/host/draft-store.ts';

const input = overrides => ({ key: 'workbench-file', generation: 'mount-1', requestId: 'request-1',
  expectedCheckpointRevision: 0, format: 'docx', sourceDiskHash: 'disk-baseline', editorRevision: 3,
  bytes: new TextEncoder().encode('restorable bytes'), ...overrides });

test('saving unchanged bytes clears dirty at the confirmed revision without moving a later saved revision backwards', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-noop-save-')), store = await DraftStore.open(directory);
  try {
    store.begin('workbench-file', 'mount-1'); await store.checkpoint(input());
    store.markSaved('workbench-file', 'mount-1', 3, 'disk-baseline', 'disk-baseline');
    assert.equal(store.load('workbench-file').savedEditorRevision, 3);
    store.markSaved('workbench-file', 'mount-1', 2, 'disk-baseline', 'disk-baseline');
    assert.equal(store.load('workbench-file').savedEditorRevision, 3);
    await store.checkpoint(input({ requestId: 'newer', editorRevision: 4, expectedCheckpointRevision: 1, bytes: Buffer.from('newer input') }));
    store.markSaved('workbench-file', 'mount-1', 3, 'disk-baseline', 'disk-baseline');
    assert.equal(store.load('workbench-file').editorRevision, 4); assert.equal(store.load('workbench-file').savedEditorRevision, 3);
  } finally { await store.close(); }
});

test('checkpoints have durable idempotent receipts, exclusive owner and generation/CAS conflicts', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-drafts-'));
  let store = await DraftStore.open(directory);
  try {
    await assert.rejects(DraftStore.open(directory), /already has a writer/);
    store.begin('workbench-file', 'mount-1');
    const record = await store.checkpoint(input());
    assert.equal(record.checkpointRevision, 1);
    assert.deepEqual(await store.checkpoint(input()), record);
    await assert.rejects(store.checkpoint(input({ bytes: new Uint8Array([0]) })), { code: 'CONFLICT' });
    await assert.rejects(store.checkpoint(input({ requestId: 'request-2', editorRevision: 4 })), { code: 'CONFLICT' });
    store.begin('workbench-file', 'mount-2');
    await assert.rejects(store.checkpoint(input({ requestId: 'request-3', expectedCheckpointRevision: 1 })), { code: 'CONFLICT' });
    await store.close();
    store = await DraftStore.open(directory);
    assert.deepEqual(store.load('workbench-file'), record);
    assert.equal(new TextDecoder().decode(await store.bytes(record)), 'restorable bytes');
    await writeFile(resolve(directory, 'blobs', record.blobHash), 'damaged');
    await assert.rejects(store.bytes(record), /damaged/);
    await assert.rejects(store.checkpoint(input()), /damaged/);
  } finally { await store.close(); }
});

test('an ACKed checkpoint and writer ownership recover after actual child-process termination', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-draft-kill-'));
  const child = spawn(process.execPath, ['--import', 'tsx/esm', 'tests/fixtures/draft-child.mjs', directory], {
    cwd: resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Child checkpoint timeout: ' + stderr)), 15_000);
      child.once('message', message => { clearTimeout(timeout); assert.equal(message, 'durable-ack'); resolveReady(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Child exited ${code}: ${stderr}`)); });
    });
    const exited = new Promise(resolveExit => child.once('exit', resolveExit));
    child.kill('SIGKILL'); await exited;
    const store = await DraftStore.open(directory);
    try {
      const record = store.load('crash-recovery');
      assert.equal(record.checkpointRevision, 1);
      assert.equal(new TextDecoder().decode(await store.bytes(record)), 'ACKed before kill');
      assert.equal(store.aiPatch('a'.repeat(64)).state, 'applied');
      assert.equal(store.aiPatch('a'.repeat(64)).checkpointRevision, record.checkpointRevision);
      store.begin('crash-recovery', 'new-host');
    } finally { await store.close(); }
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('explicit discard uses a revision guard and a replay cannot delete a newer recovered draft', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'easyview-discard-')); const store = await DraftStore.open(directory);
  try {
    store.begin('workbench-file', 'mount-1'); await store.checkpoint(input());
    await assert.rejects(store.discard('workbench-file', 'mount-1', 0, 'discard-1'), { code: 'CONFLICT' });
    await store.discard('workbench-file', 'mount-1', 1, 'discard-1'); assert.equal(store.load('workbench-file'), null);
    store.begin('workbench-file', 'mount-2');
    await store.checkpoint(input({ generation: 'mount-2', requestId: 'request-new', editorRevision: 1 }));
    await store.discard('workbench-file', 'mount-1', 1, 'discard-1');
    assert.equal(store.load('workbench-file').generation, 'mount-2');
    await assert.rejects(store.discard('workbench-file', 'mount-2', 1, 'discard-1'), { code: 'CONFLICT' });
  } finally { await store.close(); }
});
