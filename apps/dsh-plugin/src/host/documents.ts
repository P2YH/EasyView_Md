/** All file reads cross the active DSH filesystem and a registered workspace. */
import { createHash, randomUUID } from 'node:crypto';
import { posix, resolve, normalize } from 'node:path';
import { realpath } from 'node:fs/promises';
import { replaceLocalBytes, createLocalBytes } from './local-byte-writer';
import { resolvePreviewRoute, isMarkdownFilePath, type PreviewDescriptor, type WorkspaceEntry } from '@easyview/contracts';

export interface FileTarget { targetKey: string; displayPath: string }
export interface FileInfo { type: 'file' | 'directory' | 'other'; version: string; size?: number }
export interface DocumentFileSystem {
  processPath?(target: FileTarget): string;
  processPathFromHostPath(path: string): string | undefined;
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FileTarget>;
  contains(parent: FileTarget, child: FileTarget): boolean;
  stat(target: FileTarget, signal?: AbortSignal): Promise<FileInfo | undefined>;
  readBytes(target: FileTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
  listDir(target: FileTarget, signal?: AbortSignal): Promise<Array<{ name: string; type: FileInfo['type']; target: FileTarget }>>;
}
export interface WorkspaceRecord { id: string; title: string; path: string }
export interface FileReference { workspaceId: string; relativePath: string; fileIdentity: string }
export class DocumentError extends Error {
  constructor(public readonly code: 'INVALID_ARGUMENT' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'DEPENDENCY_MISSING', message: string) { super(message); }
}
interface OpenDocument {
  workspaceId: string;
  relativePath: string;
  fileIdentity: string;
  diskHash: string;
  descriptor: PreviewDescriptor;
}
export function contentHash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function workspacePath(value: string, allowRoot = false): string {
  if (value === '' && allowRoot) return value;
  // Control bytes and NTFS alternate-stream separators cannot name workspace documents.
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 4096 || /[\\:\u0000-\u001f\u007f]/.test(value)
    || value.split('/').some(segment => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment))) {
    throw new DocumentError('INVALID_ARGUMENT', '需要工作区内的相对路径。');
  }
  return value;
}

/** One shared instance serves Client reads and future AI tools; no caller-supplied OS paths. */
export class DocumentProvider {
  private readonly documents = new Map<string, OpenDocument>();
  constructor(private readonly filesystem: () => DocumentFileSystem | undefined,
    private readonly workspaces: () => WorkspaceRecord[], private readonly maxDocumentBytes: number) {}

  async list(workspaceId: string, path: string, signal?: AbortSignal): Promise<WorkspaceEntry[]> {
    const { fs, root, target } = await this.authorize(workspaceId, workspacePath(path, true), signal);
    if ((await fs.stat(target, signal))?.type !== 'directory') throw new DocumentError('NOT_FOUND', '目录不存在。');
    const entries = await fs.listDir(target, signal);
    return entries.filter(entry => fs.contains(root, entry.target) && ['file', 'directory'].includes(entry.type)).map(entry => ({
      id: contentHash(Buffer.from(`${workspaceId}\0${entry.target.targetKey}`)), rootId: workspaceId,
      relativePath: path ? `${path}/${entry.name}` : entry.name, name: entry.name, kind: entry.type === 'directory' ? 'directory' : 'file',
    }));
  }

  async open(workspaceId: string, path: string, signal?: AbortSignal): Promise<PreviewDescriptor & { diskHash: string }> {
    path = workspacePath(path);
    const { fs, target } = await this.authorize(workspaceId, path, signal);
    const before = await fs.stat(target, signal);
    if (before?.type !== 'file') throw new DocumentError('NOT_FOUND', '文件不存在或不是普通文件。');
    const fileName = posix.basename(path);
    // The upstream preview map excludes Markdown because its normal route is editor-core.
    // Until durable text synchronization is connected, use the original text preview.
    const definition = resolvePreviewRoute(isMarkdownFilePath(fileName) ? 'document.txt' : fileName);
    if (!definition) throw new DocumentError('INVALID_ARGUMENT', '当前格式尚无预览器。');
    const bytes = await fs.readBytes(target, signal, Math.min(this.maxDocumentBytes, definition.maxSourceBytes));
    if ((await fs.stat(target, signal))?.version !== before.version) throw new DocumentError('CONFLICT', '文件在读取时发生变化，请重新打开。');
    const documentId = randomUUID();
    if (this.documents.size >= 512) throw new DocumentError('CONFLICT', '打开的文档会话已达到上限，请关闭部分标签后重试。');
    const diskHash = contentHash(bytes);
    const descriptor: PreviewDescriptor = { sessionId: documentId, relativePath: path, fileName: posix.basename(path),
      route: definition.route, size: bytes.byteLength, mtimeMs: 0, mimeType: definition.mimeType,
      contentUrl: `/api/easyview/v1/content?documentId=${documentId}` };
    this.documents.set(documentId, { workspaceId, relativePath: path, fileIdentity: target.targetKey, diskHash, descriptor });
    return { ...descriptor, diskHash };
  }

  async read(documentId: string, signal?: AbortSignal): Promise<Uint8Array> {
    const document = this.documents.get(documentId);
    if (!document) throw new DocumentError('NOT_FOUND', '文档会话不存在，请重新打开。');
    const { fs, target } = await this.authorize(document.workspaceId, document.relativePath, signal);
    if (target.targetKey !== document.fileIdentity) throw new DocumentError('CONFLICT', '文件身份已变化，请重新打开。');
    const bytes = await fs.readBytes(target, signal, this.maxDocumentBytes);
    if (contentHash(bytes) !== document.diskHash) throw new DocumentError('CONFLICT', '原件已发生变化，请重新打开并处理草稿冲突。');
    return bytes;
  }

  close(documentId: string): void { this.documents.delete(documentId); }
  dispose(): void { this.documents.clear(); }

  reference(documentId: string): FileReference {
    const document = this.documents.get(documentId);
    if (!document) throw new DocumentError('NOT_FOUND', '文档会话不存在。');
    return { workspaceId: document.workspaceId, relativePath: document.relativePath, fileIdentity: contentHash(Buffer.from(document.fileIdentity)) };
  }

  async readReference(reference: FileReference): Promise<Uint8Array> {
    const { fs, target } = await this.authorize(reference.workspaceId, workspacePath(reference.relativePath));
    if (contentHash(Buffer.from(target.targetKey)) !== reference.fileIdentity) throw new DocumentError('CONFLICT', '文件物理身份已变化。');
    return fs.readBytes(target, undefined, this.maxDocumentBytes);
  }

  async creationTarget(workspaceId: string, path: string): Promise<FileReference> {
    path = workspacePath(path);
    if (!isMarkdownFilePath(path) || path.split('/').some(part => /[<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
      throw new DocumentError('INVALID_ARGUMENT', '仅支持在已有目录中新建 Markdown 文件。');
    }
    const { fs, target } = await this.authorize(workspaceId, path);
    const parent = await this.authorize(workspaceId, posix.dirname(path) === '.' ? '' : posix.dirname(path));
    if ((await fs.stat(parent.target))?.type !== 'directory') throw new DocumentError('NOT_FOUND', '目标目录不存在。');
    return { workspaceId, relativePath: path, fileIdentity: contentHash(Buffer.from(target.targetKey)) };
  }
  async inspectReference(reference: FileReference): Promise<Uint8Array | null> {
    const { fs, target } = await this.authorize(reference.workspaceId, workspacePath(reference.relativePath));
    if (contentHash(Buffer.from(target.targetKey)) !== reference.fileIdentity) throw new DocumentError('CONFLICT', '文件物理身份已变化。');
    const info = await fs.stat(target);
    if (!info) return null;
    if (info.type !== 'file') throw new DocumentError('CONFLICT', '目标不是普通文件。');
    return fs.readBytes(target, undefined, this.maxDocumentBytes);
  }
  async createReference(reference: FileReference, bytes: Uint8Array): Promise<void> {
    const target = await this.creationTarget(reference.workspaceId, reference.relativePath);
    if (target.fileIdentity !== reference.fileIdentity || await this.inspectReference(reference) !== null) throw new DocumentError('CONFLICT', '目标已存在，新建未执行。');
    const parentPath = posix.dirname(reference.relativePath), parent = await this.authorize(reference.workspaceId, parentPath === '.' ? '' : parentPath);
    const workspace = this.workspaces().find(value => value.id === reference.workspaceId)!;
    const hostRoot = await realpath(workspace.path), hostParent = await realpath(resolve(workspace.path, parentPath));
    if (!parent.fs.processPath || hostParent.startsWith('\\\\') || normalize(parent.fs.processPath(parent.root)) !== normalize(hostRoot)
      || normalize(parent.fs.processPath(parent.target)) !== normalize(hostParent)) throw new DocumentError('DEPENDENCY_MISSING', '此文件系统不支持安全新建。');
    await createLocalBytes(resolve(hostParent, posix.basename(reference.relativePath)), bytes, async () => {
      const current = await this.creationTarget(reference.workspaceId, reference.relativePath);
      if (current.fileIdentity !== reference.fileIdentity || await this.inspectReference(reference) !== null) throw new DocumentError('CONFLICT', '目标已存在，新建未执行。');
    });
  }

  async replaceReference(reference: FileReference, bytes: Uint8Array, expectedHash: string): Promise<void> {
    const { fs, root, target } = await this.authorize(reference.workspaceId, workspacePath(reference.relativePath));
    const workspace = this.workspaces().find(value => value.id === reference.workspaceId)!;
    const hostRoot = await realpath(workspace.path), hostPath = await realpath(resolve(workspace.path, reference.relativePath));
    // A process path is usable by Node only when the Provider maps this exact
    // authorized workspace to the same host filesystem execution world.
    if (!fs.processPath || hostPath.startsWith('\\\\') || normalize(fs.processPath(root)) !== normalize(hostRoot)
      || normalize(fs.processPath(target)) !== normalize(hostPath)) throw new DocumentError('DEPENDENCY_MISSING', '此文件系统不支持本地字节提交，请使用工作副本。');
    await replaceLocalBytes(hostPath, bytes, async () => {
      if (contentHash(await this.readReference(reference)) !== expectedHash) throw new DocumentError('CONFLICT', '提交前原件已变化，已保留外部修改。');
    });
  }

  saved(documentId: string, diskHash: string): void {
    const document = this.documents.get(documentId); if (document) document.diskHash = diskHash;
  }

  async draftIdentity(documentId: string, signal?: AbortSignal) {
    const document = this.documents.get(documentId);
    if (!document) throw new DocumentError('NOT_FOUND', '文档会话不存在。');
    const { target } = await this.authorize(document.workspaceId, document.relativePath, signal);
    if (target.targetKey !== document.fileIdentity) throw new DocumentError('CONFLICT', '文件身份已变化，恢复草稿仍保留。');
    const suffix = posix.extname(document.relativePath).toLowerCase();
    const format = suffix === '.docx' ? 'docx' : suffix === '.xlsx' ? 'xlsx'
      : isMarkdownFilePath(document.relativePath) ? 'markdown' : suffix === '.txt' ? 'text' : null;
    return { fileIdentity: contentHash(Buffer.from(document.fileIdentity)), diskHash: document.diskHash, format };
  }

  private async authorize(workspaceId: string, path: string, signal?: AbortSignal) {
    const workspace = this.workspaces().find(workspace => workspace.id === workspaceId);
    if (!workspace) throw new DocumentError('PERMISSION_DENIED', '工作区未授权或已移除。');
    const fs = this.filesystem();
    if (!fs) throw new DocumentError('DEPENDENCY_MISSING', 'DSH filesystem Provider 不可用。');
    const worldPath = fs.processPathFromHostPath(workspace.path);
    if (!worldPath) throw new DocumentError('DEPENDENCY_MISSING', '当前文件系统执行环境无法访问这个工作区。');
    const root = await fs.resolve(worldPath, { signal });
    const target = await fs.resolve(path || '.', { cwd: worldPath, signal });
    if (!fs.contains(root, target)) throw new DocumentError('PERMISSION_DENIED', '路径超出授权工作区。');
    return { fs, root, target };
  }
}
