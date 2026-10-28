import { DraftStore } from '../../src/host/draft-store.ts';
import { OperationJournal } from '../../src/host/operation-journal.ts';
import { replaceLocalBytes, createLocalBytes } from '../../src/host/local-byte-writer.ts';
import { contentHash } from '../../src/host/documents.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [directory, point, kind] = process.argv.slice(2);
const store = await DraftStore.open(directory);
const path = resolve(directory, 'original.txt');
const target = { workspaceId: 'fixture', relativePath: 'original.txt', fileIdentity: 'one-file' };
const journal = new OperationJournal(directory, store, {
  inspectReference: async () => { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
  createReference: (_target, bytes) => createLocalBytes(path, bytes, async () => {}),
  readReference: () => readFile(path),
  replaceReference: (_target, bytes, baseHash) => replaceLocalBytes(path, bytes, async () => {
    if (contentHash(await readFile(path)) !== baseHash) throw new Error('external change');
  }),
}, async (at, operation) => {
  if (at === point && (kind !== 'undo' || operation.kind === 'undo')) {
    process.send({ point: at, operationId: operation.operationId });
    await new Promise(() => {});
  }
});
await journal.recover();
const input = { requestId: 'save-request', target, baseHash: contentHash(Buffer.from('before')), bytes: Buffer.from('after'), editorRevision: 1 };
const operation = kind === 'create' ? await journal.create({ requestId: input.requestId, target, bytes: input.bytes }) : await journal.save(input);
if (kind === 'undo') await journal.undo(operation.operationId, 'undo-request');
setInterval(() => {}, 1000);
