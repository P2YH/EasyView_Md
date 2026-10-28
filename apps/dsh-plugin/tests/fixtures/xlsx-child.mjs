import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context, runtimeRoot } from '../runtime.mjs';
import { DocumentProvider } from '../../src/host/documents.ts';
import { DraftStore } from '../../src/host/draft-store.ts';
import { OperationJournal } from '../../src/host/operation-journal.ts';
import { XlsxProposals } from '../../src/host/xlsx-proposals.ts';
import { installDraftRoutes } from '../../src/host/draft-routes.ts';
const home = process.argv[2], { LocalFileSystem } = await import(pathToFileURL(resolve(runtimeRoot, 'packages/fs/fs-local/lib/index.js')).href);
const ctx = new Context(), fs = ctx.plugin(LocalFileSystem, { cwd: home }); await fs.await();
const documents = new DocumentProvider(() => ctx.get('fs'), () => [{ id: 'w', title: 'fixture', path: home }], 1024 * 1024);
const store = await DraftStore.open(resolve(home, 'data')), journal = new OperationJournal(resolve(home, 'data'), store, documents, async (point, operation) => {
  if (point === process.argv[3]) { process.send({ point, operationId: operation.operationId }); await new Promise(() => {}); }
}), routes = new Map();
const mounts = installDraftRoutes({ register: route => routes.set(route.path.split('/').at(-1), route), documents, store, journal,
  maxBytes: 1024 * 1024, maxPending: 2, isDisposed: () => false });
const descriptor = await documents.open('w', 'book.xlsx'), address = { documentId: descriptor.sessionId, workbenchId: randomUUID(), generation: randomUUID(), workspaceId: 'w' };
await routes.get('draft-attach').fetch(new Request('http://dsh/api/easyview/v1/draft-attach', { method: 'POST', body: JSON.stringify(address) }));
const proposals = new XlsxProposals(resolve(home, 'data'), store, journal, documents, mounts), signal = new AbortController().signal;
const inspected = await proposals.inspect(address, signal);
void proposals.propose({ address, conversationKey: 'conversation', requestId: 'request', toolId: randomUUID(), signal,
  args: { fingerprint: inspected.fingerprint, ops: [{ op: 'setCell', sheet: 'First', ref: 'A1', value: 'must not publish after kill' }] } });
const interval = setInterval(() => {
  const card = proposals.projection('conversation', 'request')[0];
  if (card) {
    clearInterval(interval); process.send({ card });
    if (process.argv[3]) void proposals.decide('conversation', { proposalId: card.proposalId, decisionId: randomUUID(), accepted: true, editorRevision: 0 });
  }
}, 5);
setInterval(() => {}, 1000);
