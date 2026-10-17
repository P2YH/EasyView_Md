import { createReadStream, promises as fs } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { writeFileAtomically } from '@easyview/node-runtime';
import { createContentHasher, hashContent } from '@easyview/editor-sync';

export type CompareAndWriteResult = 'ok' | 'conflict';

export interface DocumentFileStat {
  mtimeMs: number;
  isFile: boolean;
}

/**
 * Filesystem boundary for document save/rename. Tests inject a fake so the
 * check-then-write window can be controlled without touching the real disk.
 */
export interface DocumentFileSystem {
  readFile(filePath: string): Promise<string>;
  writeFileAtomically(filePath: string, content: string): Promise<void>;
  /**
   * Read, compare against the expected raw-content hash, and write without
   * exposing a caller-visible gap. Production still has a tiny OS-level
   * TOCTOU window; the in-process file lock plus this single entry point is
   * the contract tests assert against.
   */
  compareAndWrite(filePath: string, expectedHash: string, content: string): Promise<CompareAndWriteResult>;
  stat(filePath: string): Promise<DocumentFileStat>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

export function createNodeDocumentFileSystem(): DocumentFileSystem {
  return {
    readFile(filePath) {
      return fs.readFile(filePath, 'utf8');
    },
    writeFileAtomically(filePath, content) {
      return writeFileAtomically(filePath, content);
    },
    async compareAndWrite(filePath, expectedHash, content) {
      try {
        const before = await fingerprintDocument(filePath);
        if (!before.stable || before.hash !== expectedHash) return 'conflict';
        // Nanosecond metadata is a quick rejection, never a substitute for the
        // second content check (same-size writes can preserve timestamps).
        if (!sameFileVersion(before.stat, await fs.stat(filePath, { bigint: true }))) return 'conflict';
        const checked = await fingerprintDocument(filePath);
        if (!checked.stable || checked.hash !== expectedHash || !sameFileVersion(before.stat, checked.stat)) return 'conflict';
        await writeFileAtomically(filePath, content);
        const published = await fingerprintDocument(filePath);
        if (!published.stable || published.hash !== hashContent(content)) return 'conflict';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'conflict';
        throw error;
      }
      return 'ok';
    },
    async stat(filePath) {
      const stats = await fs.stat(filePath);
      return { mtimeMs: stats.mtimeMs, isFile: stats.isFile() };
    },
    link(existingPath, newPath) {
      return fs.link(existingPath, newPath);
    },
    unlink(filePath) {
      return fs.unlink(filePath);
    },
  };
}

function sameFileVersion(a: import('node:fs').BigIntStats, b: import('node:fs').BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** Bounded buffers; StringDecoder preserves split UTF-8 sequences and BOM semantics. */
export async function fingerprintDocument(filePath: string) {
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createContentHasher();
    const decoder = new StringDecoder('utf8');
    for await (const chunk of createReadStream(filePath, { fd: handle.fd, autoClose: false, highWaterMark: 64 * 1024 })) {
      hash.update(decoder.write(chunk as Buffer));
    }
    hash.update(decoder.end());
    const after = await handle.stat({ bigint: true });
    const current = await fs.stat(filePath, { bigint: true });
    return { hash: hash.digest(), stat: current, stable: sameFileVersion(before, after) && sameFileVersion(after, current) };
  } finally { await handle.close(); }
}
