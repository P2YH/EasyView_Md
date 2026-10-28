import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Context, runtimeRoot } from './runtime.mjs';
import { DocumentProvider, contentHash } from '../src/host/documents.ts';
import { DraftStore } from '../src/host/draft-store.ts';
import { OperationJournal } from '../src/host/operation-journal.ts';
import { installDraftRoutes } from '../src/host/draft-routes.ts';
import { XlsxProposals } from '../src/host/xlsx-proposals.ts';

async function fixture(fault) {
  const home = await mkdtemp(resolve(tmpdir(), 'easyview-xlsx-proposals-')), file = resolve(home, 'book.xlsx');
  const workbook = new ExcelJS.Workbook();
  for (const name of ['First', 'Second']) { const sheet = workbook.addWorksheet(name); sheet.getCell('A1').value = `${name} before`; sheet.getCell('B2').value = { formula: '1+2', result: 3 }; }
  await workbook.xlsx.writeFile(file); const original = await readFile(file);
  const { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
  const ctx = new Context(), fs = ctx.plugin(LocalFileSystem, { cwd: home }); await fs.await();
  const documents = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: home }], 1024 * 1024);
  const data = resolve(home, 'data'), store = await DraftStore.open(data), journal = new OperationJournal(data, store, documents, fault);
  const routes = new Map(), mounts = installDraftRoutes({ register: route => routes.set(route.path.split('/').at(-1), route),
    documents, store, journal, maxBytes: 1024 * 1024, maxPending: 2, isDisposed: () => false });
  const descriptor = await documents.open('w', 'book.xlsx'), address = { documentId: descriptor.sessionId, workbenchId: randomUUID(), generation: randomUUID(), workspaceId: 'w' };
  await routes.get('draft-attach').fetch(new Request('http://dsh/api/easyview/v1/draft-attach', { method: 'POST', body: JSON.stringify(address) }));
  const key = contentHash(Buffer.from(`${address.workbenchId}\0${documents.reference(address.documentId).fileIdentity}`));
  const proposals = new XlsxProposals(data, store, journal, documents, mounts);
  return { home, data, file, original, documents, store, journal, mounts, address, key, proposals,
    async close() { await proposals.close(); await journal.close(); await store.close(); documents.dispose(); await fs.dispose(); } };
}
async function pending(f, input = {}) {
  const signal = input.signal ?? new AbortController().signal;
  const inspected = await f.proposals.inspect(f.address, signal);
  const args = { fingerprint: inspected.fingerprint, ops: [{ op: 'setCell', sheet: 'First', ref: 'A1', value: 'AI changed' },
    { op: 'setCell', sheet: 'Second', ref: 'C3', value: 42 }] };
  const toolId = input.toolId ?? randomUUID();
  const task = f.proposals.propose({ address: f.address, conversationKey: 'conversation', requestId: 'request', toolId, args, signal });
  // Attach a rejection handler while the caller waits for durable visibility.
  void task.catch(() => {});
  for (let attempt = 0; attempt < 200; attempt++) {
    const card = f.proposals.projection('conversation', 'request').find(card => card.status === 'pending');
    if (card) return { task, card, args, signal, toolId };
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await task; throw new Error('Proposal did not become visible');
}
const decision = (card, accepted = true) => ({ proposalId: card.proposalId, decisionId: randomUUID(), accepted, editorRevision: 0 });

test('XLSX original diff stays staged until decision; rejection, committed retry and guarded file undo preserve exact bytes', async () => {
  const f = await fixture();
  try {
    const rejected = await pending(f);
    assert.equal(rejected.card.total, 2); assert.deepEqual(await readFile(f.file), f.original);
    assert.equal((await f.proposals.decide('conversation', decision(rejected.card, false))).state, 'rejected');
    assert.equal((await rejected.task).state, 'rejected'); assert.equal(f.journal.list().length, 0);
    const accepted = await pending(f), input = decision(accepted.card);
    await assert.rejects(f.proposals.decide('other-conversation', input), { code: 'PERMISSION_DENIED' });
    const committed = await f.proposals.decide('conversation', input);
    assert.equal(committed.state, 'committed'); assert.deepEqual(await accepted.task, committed);
    assert.deepEqual(await f.proposals.decide('conversation', input), committed);
    await assert.rejects(f.proposals.decide('conversation', { ...input, accepted: false }), { code: 'CONFLICT' });
    assert.deepEqual(await f.proposals.propose({ address: f.address, conversationKey: 'conversation', requestId: 'request', toolId: accepted.toolId,
      args: accepted.args, signal: accepted.signal }), committed);
    const zip = await JSZip.loadAsync(await readFile(f.file));
    assert.match(await zip.file('xl/sharedStrings.xml').async('string'), /AI changed/);
    assert.match(await zip.file('xl/worksheets/sheet2.xml').async('string'), /<v>42<\/v>/);
    for (const name of ['sheet1', 'sheet2']) assert.match(await zip.file(`xl/worksheets/${name}.xml`).async('string'), /<f[^>]*>1\+2<\/f>/);
    assert.equal(f.proposals.projection('conversation', 'request').at(-1).commitId, committed.operationId);
    const undo = await f.journal.undo(committed.operationId, randomUUID()); assert.equal(undo.state, 'committed');
    assert.deepEqual(await readFile(f.file), f.original); assert.equal(f.proposals.projection('conversation', 'request').at(-1).status, 'undone');
  } finally { await f.close(); }
});

test('dirty workbooks cannot generate or accept stale proposals; cancellation before prepared never writes', async () => {
  const f = await fixture();
  try {
    const proposed = await pending(f);
    await f.store.checkpoint({ key: f.key, generation: f.address.generation, requestId: randomUUID(), expectedCheckpointRevision: 0,
      format: 'xlsx', sourceDiskHash: contentHash(f.original), editorRevision: 1, bytes: f.original });
    const result = await f.proposals.decide('conversation', decision(proposed.card));
    assert.equal(result.state, 'conflict'); assert.equal((await proposed.task).state, 'conflict');
    assert.equal(f.journal.list().length, 0); assert.deepEqual(await readFile(f.file), f.original);
    const inspected = await f.proposals.inspect(f.address, new AbortController().signal);
    await assert.rejects(f.proposals.propose({ address: f.address, conversationKey: 'conversation', requestId: 'request', toolId: randomUUID(),
      args: { fingerprint: inspected.fingerprint, ops: [{ op: 'setCell', sheet: 'First', ref: 'A1', value: 'must not write' }] }, signal: new AbortController().signal }), { code: 'CONFLICT' });
  } finally { await f.close(); }
  for (const point of ['F01', 'F02']) {
    const abort = new AbortController(), f = await fixture(async at => { if (at === point) abort.abort(); });
    try {
      const proposed = await pending(f, { signal: abort.signal });
      const result = await f.proposals.decide('conversation', decision(proposed.card)); await proposed.task;
      if (point === 'F01') { assert.equal(result.state, 'cancelled'); assert.equal(f.journal.list().length, 0); assert.deepEqual(await readFile(f.file), f.original); }
      else { assert.equal(result.state, 'committed', 'prepared won; cancellation must not claim rollback'); assert.equal(f.journal.list().length, 1); }
    } finally { await f.close(); }
  }
});

test('no-change workbook tool calls have durable receipts without a decision card or file operation', async () => {
  const f = await fixture();
  try {
    const inspected = await f.proposals.inspect(f.address, new AbortController().signal);
    const input = { address: f.address, conversationKey: 'conversation', requestId: 'request', toolId: randomUUID(), signal: new AbortController().signal,
      args: { fingerprint: inspected.fingerprint, ops: [{ op: 'setCell', sheet: 'First', ref: 'A1', value: 'First before' }] } };
    const result = await f.proposals.propose(input); assert.equal(result.state, 'no_change');
    assert.deepEqual(await f.proposals.propose(input), result); assert.deepEqual(f.proposals.projection('conversation', 'request'), []);
    assert.equal(f.journal.list().length, 0); assert.deepEqual(await readFile(f.file), f.original);
    await assert.rejects(f.proposals.propose({ ...input, args: { ...input.args, fingerprint: 'different' } }), { code: 'CONFLICT' });
  } finally { await f.close(); }
});

test('Host close expires a pending original card; reopen decisions return proposal_expired without replay', async () => {
  const f = await fixture();
  try {
    const proposed = await pending(f);
    await f.proposals.close(); assert.equal((await proposed.task).state, 'expired');
    const reopened = new XlsxProposals(f.data, f.store, f.journal, f.documents, f.mounts);
    try {
      assert.equal(reopened.projection('conversation', 'request')[0].status, 'error');
      const result = await reopened.decide('conversation', decision(proposed.card));
      assert.equal(result.code, 'proposal_expired'); assert.equal(result.terminal, true); assert.deepEqual(await readFile(f.file), f.original);
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('actual Host process kill expires an unprepared XLSX proposal; restart does not publish its candidate', async () => {
  const f = await fixture(); await f.close();
  const child = fork(new URL('./fixtures/xlsx-child.mjs', import.meta.url), [f.home], { execArgv: ['--import', 'tsx/esm'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pending XLSX child timed out')), 15_000);
    child.once('message', value => { clearTimeout(timer); resolve(value); }); child.once('error', reject);
    child.once('exit', code => { if (code) reject(new Error(`XLSX child exited ${code}`)); });
  });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  const store = await DraftStore.open(f.data), journal = new OperationJournal(f.data, store, f.documents); await journal.recover();
  const proposals = new XlsxProposals(f.data, store, journal, f.documents, { clean() { throw new Error('Old execution must never be admitted'); } });
  try {
    const result = await proposals.decide('conversation', decision(message.card));
    assert.equal(result.code, 'proposal_expired'); assert.deepEqual(await readFile(f.file), f.original); assert.equal(journal.list().length, 0);
  } finally { await proposals.close(); await journal.close(); await store.close(); }
});

for (const point of ['F02', 'F03']) test(`XLSX ${point}: actual killed accepted proposal recovers only from journal evidence`, async () => {
  const f = await fixture(); await f.close();
  const child = fork(new URL('./fixtures/xlsx-child.mjs', import.meta.url), [f.home, point], { execArgv: ['--import', 'tsx/esm'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let card;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Accepted XLSX child timed out')); }, 15_000);
    child.on('message', value => { if (value.card) card = value.card; if (value.point === point) { clearTimeout(timer); resolve(); } });
    child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`Accepted XLSX child exited ${code}`)); });
  });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  const beforeRecovery = await readFile(f.file), store = await DraftStore.open(f.data);
  const journal = new OperationJournal(f.data, store, { readReference: async () => readFile(f.file), replaceReference: async () => { throw new Error('Recovery must not replay writes'); } });
  await journal.recover();
  const proposals = new XlsxProposals(f.data, store, journal, f.documents, { clean() { throw new Error('Old execution must never be admitted'); } });
  try {
    const result = await proposals.decide('conversation', decision(card));
    assert.equal(result.state, point === 'F02' ? 'not_applied' : 'committed');
    assert.equal(result.terminal, true); assert.deepEqual(await readFile(f.file), beforeRecovery); assert.equal(journal.list().length, 1);
    if (point === 'F02') assert.deepEqual(beforeRecovery, f.original);
    else assert.notDeepEqual(beforeRecovery, f.original);
  } finally { await proposals.close(); await journal.close(); await store.close(); }
});
