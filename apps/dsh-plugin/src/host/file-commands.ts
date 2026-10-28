import { contentHash, DocumentError, type DocumentProvider } from './documents';
import type { OperationJournal } from './operation-journal';

/** A single authorization/journal path for the file tree and scoped AI tools. */
export class FileCommands {
  constructor(private readonly documents: DocumentProvider, private readonly journal: OperationJournal, private readonly maxBytes: number) {}
  async createMarkdown(input: { workspaceId: string; path: string; content: string; requestId: string }, signal?: AbortSignal) {
    if (!input || typeof input.workspaceId !== 'string' || typeof input.path !== 'string' || typeof input.content !== 'string'
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(input.requestId)) throw new DocumentError('INVALID_ARGUMENT', '无效的新建文件请求。');
    const bytes = Buffer.from(input.content, 'utf8');
    if (bytes.length > this.maxBytes) throw new DocumentError('INVALID_ARGUMENT', '新文档超出配置容量限制。');
    const target = await this.documents.creationTarget(input.workspaceId, input.path);
    signal?.throwIfAborted();
    const requestHash = contentHash(Buffer.from(JSON.stringify({ kind: 'create-markdown', target, bytes: contentHash(bytes) })));
    const operation = await this.journal.create({ target, bytes, requestId: input.requestId, requestHash, signal });
    return { operationId: operation.operationId, state: operation.state, path: target.relativePath, canUndo: false as const };
  }
}
