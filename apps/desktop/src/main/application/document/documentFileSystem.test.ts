import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hashContent } from '@easyview/editor-sync';
import { createNodeDocumentFileSystem, fingerprintDocument } from './documentFileSystem';
import * as runtime from '@easyview/node-runtime';
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture(text: string) {
  const dir = await fs.mkdtemp(path.join(process.cwd(), '.save-fingerprint-test-')); directories.push(dir);
  const file = path.join(dir, 'document.md'); await fs.writeFile(file, text); return file;
}
describe('streaming compare and write', () => {
  it('matches UTF-16 hashes for BOM, invalid UTF-8 and split multibyte sequences without readFile', async () => {
    const file = await fixture('\uFEFF' + '中😀'.repeat(70_000));
    await fs.appendFile(file, Buffer.from([0xff, 0xe2, 0x82]));
    const text = await fs.readFile(file, 'utf8');
    const read = vi.spyOn(fs, 'readFile');
    expect((await fingerprintDocument(file)).hash).toBe(hashContent(text));
    expect(read).not.toHaveBeenCalled();
  });
  it('saves matching content and rejects stale/missing content with zero full reads', async () => {
    const file = await fixture('before'); const disk = createNodeDocumentFileSystem();
    const read = vi.spyOn(fs, 'readFile');
    expect(await disk.compareAndWrite(file, hashContent('before'), 'after')).toBe('ok');
    expect(await disk.compareAndWrite(file, hashContent('before'), 'lost')).toBe('conflict');
    expect(await disk.compareAndWrite(file + '.missing', hashContent(''), 'new')).toBe('conflict');
    expect(read).not.toHaveBeenCalled(); read.mockRestore(); expect(await fs.readFile(file, 'utf8')).toBe('after');
  });
  it('detects same-size concurrent writes even when mtime is restored', async () => {
    const file = await fixture('original'); const originalStat = await fs.stat(file); const realStat = fs.stat.bind(fs);
    let checks = 0;
    vi.spyOn(fs, 'stat').mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      checks++;
      if (checks === 2) { await fs.writeFile(file, 'external'); await fs.utimes(file, originalStat.atime, originalStat.mtime); }
      return realStat(...args);
    });
    expect(await createNodeDocumentFileSystem().compareAndWrite(file, hashContent('original'), 'ours')).toBe('conflict');
    expect(await fs.readFile(file, 'utf8')).toBe('external');
  });
  it('reports a concurrent writer after atomic replacement as conflict', async () => {
    const file = await fixture('original');
    const real = runtime.writeFileAtomically;
    vi.spyOn(runtime, 'writeFileAtomically').mockImplementation(async (target, content) => { await real(target, content); await fs.writeFile(target, 'external'); });
    expect(await createNodeDocumentFileSystem().compareAndWrite(file, hashContent('original'), 'ours')).toBe('conflict');
  });
});
