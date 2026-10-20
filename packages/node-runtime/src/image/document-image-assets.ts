import { lstat, mkdir, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { documentAssetsDirectoryName, mimeForImageExtension, sanitizeDocumentStem } from './image-security';

const parser = new MarkdownIt({ html: true });
const reservedPaths = new Map<string, number>();
const pathKey = (value: string) => process.platform === 'win32' || process.platform === 'darwin'
  ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Deleted names remain reserved while the document can undo their deletion. */
export function isImageAssetReserved(filePath: string): boolean {
  return reservedPaths.has(pathKey(filePath));
}

function references(markdown: string, directory: string): Set<string> {
  const result = new Set<string>();
  const add = (source: string | null) => {
    if (!source) return;
    let decoded: string;
    try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]); } catch { return; }
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) && !path.isAbsolute(decoded)) return;
    const target = path.resolve(path.dirname(directory), decoded.replaceAll('\\', '/'));
    // Only images directly owned by this document's generated assets directory.
    if (pathKey(path.dirname(target)) === pathKey(directory) && mimeForImageExtension(target)) result.add(target);
  };
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'image') add(token.attrGet('src'));
      if (token.type === 'link_open') add(token.attrGet('href'));
      if (token.type === 'html_inline' || token.type === 'html_block') {
        for (const match of token.content.matchAll(/<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          add(match[1] ?? match[2] ?? match[3]);
        }
      }
      if (token.children) visit(token.children);
    }
  };
  visit(parser.parse(markdown, {}));
  return result;
}

async function existsFile(filePath: string): Promise<boolean> {
  try { return (await lstat(filePath)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function assertOwnedDirectory(directory: string): Promise<void> {
  const expected = path.join(await realpath(path.dirname(directory)), path.basename(directory));
  if (pathKey(await realpath(directory)) !== pathKey(expected)) throw new Error('Image assets directory is a symbolic link');
}

/** Owns image deletion, empty-directory removal and undo restoration for one document session. */
export class DocumentImageAssets {
  private readonly removed = new Map<string, { bytes: Buffer }>();
  private pending: Promise<void> = Promise.resolve();

  whenIdle(): Promise<void> { return this.pending; }

  reconcile(documentPath: string, before: string, after: string): Promise<void> {
    const update = async () => {
      if (before === after || (!before.includes('.assets') && !after.includes('.assets') && !this.removed.size)) return;
      const directory = path.join(path.dirname(documentPath), documentAssetsDirectoryName(sanitizeDocumentStem(documentPath)));
      const previous = references(before, directory);
      const current = references(after, directory);
      const currentKeys = new Set([...current].map(pathKey));
      for (const target of current) {
        const key = pathKey(target);
        const deleted = this.removed.get(key);
        if (!deleted) continue;
        await mkdir(directory, { recursive: true });
        await assertOwnedDirectory(directory);
        if (await existsFile(target)) {
          if (!(await readFile(target)).equals(deleted.bytes)) throw new Error(`Cannot restore image over a different file: ${target}`);
        } else await writeFile(target, deleted.bytes, { flag: 'wx' });
        this.release(key);
      }
      for (const target of previous) {
        if (currentKeys.has(pathKey(target)) || !await existsFile(target)) continue;
        await assertOwnedDirectory(directory);
        const bytes = await readFile(target);
        await unlink(target);
        const key = pathKey(target);
        if (!this.removed.has(key)) reservedPaths.set(key, (reservedPaths.get(key) ?? 0) + 1);
        this.removed.set(key, { bytes });
      }
      if (previous.size) {
        try { await rmdir(directory); }
        catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
      }
    };
    const operation = this.pending.then(update, update);
    this.pending = operation;
    // Callers await whenIdle / reconcile; keep pending background operations observed until then.
    void operation.catch(() => undefined);
    return operation;
  }

  dispose(): void {
    const release = () => { for (const key of this.removed.keys()) this.release(key); };
    void this.pending.then(release, release);
  }

  private release(key: string): void {
    this.removed.delete(key);
    const owners = (reservedPaths.get(key) ?? 1) - 1;
    if (owners) reservedPaths.set(key, owners);
    else reservedPaths.delete(key);
  }
}
