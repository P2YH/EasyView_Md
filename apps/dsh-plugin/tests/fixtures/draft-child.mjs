import { DraftStore } from '../../src/host/draft-store.ts';
import { contentHash } from '../../src/host/documents.ts';
const store = await DraftStore.open(process.argv[2]);
store.begin('crash-recovery', 'old-host');
const bytes = new TextEncoder().encode('ACKed before kill');
store.prepareAiPatch({ operationId: 'a'.repeat(64), key: 'crash-recovery', generation: 'old-host',
  baseRevision: 0, outputHash: contentHash(bytes), inputHash: 'b'.repeat(64), state: 'pending' });
await store.checkpoint({ key: 'crash-recovery', generation: 'old-host', requestId: 'kill-checkpoint',
  expectedCheckpointRevision: 0, format: 'markdown', sourceDiskHash: 'base', editorRevision: 1,
  bytes, aiOperationId: 'a'.repeat(64) });
process.send('durable-ack');
setInterval(() => {}, 1000);
