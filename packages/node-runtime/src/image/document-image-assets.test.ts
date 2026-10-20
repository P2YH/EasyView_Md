import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentImageAssets, isImageAssetReserved } from './document-image-assets';
import { savePastedImage } from './image-service';

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
const image = '![](.设计-文档.assets/image.png)';

async function fixture(run: (input: { root: string; documentPath: string; directory: string; file: string; assets: DocumentImageAssets }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'easyview-image-assets-'));
  const documentPath = path.join(root, '设计 文档.md');
  const directory = path.join(root, '.设计-文档.assets');
  const assets = new DocumentImageAssets();
  await writeFile(documentPath, image);
  const saved = await savePastedImage({ documentPath, dataUrl, preferredName: 'image' });
  try { await run({ root, documentPath, directory, file: saved.filePath, assets }); }
  finally { assets.dispose(); await assets.whenIdle().catch(() => undefined); await rm(root, { recursive: true, force: true }); }
}

describe('document image asset lifecycle', () => {
  it('deletes the last referenced image and its empty folder, and restores both for undo', async () => {
    await fixture(async ({ documentPath, directory, file, assets }) => {
      await assets.reconcile(documentPath, image, '');
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(isImageAssetReserved(file)).toBe(true);
      await assets.reconcile(documentPath, '', image);
      expect(await readFile(file)).toEqual(bytes);
      expect(isImageAssetReserved(file)).toBe(false);
      await assets.reconcile(documentPath, image, '');
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('keeps a file while another inline, reference, HTML, or download link still references it', async () => {
    await fixture(async ({ documentPath, file, assets }) => {
      for (const retained of [image, '![][picture]\n\n[picture]: .设计-文档.assets/image.png',
        '<img src="./.设计-文档.assets/image.png">', '[Download](.设计-文档.assets/image.png)',
        '![](.%E8%AE%BE%E8%AE%A1-%E6%96%87%E6%A1%A3.assets/image.png?version=1)']) {
        await assets.reconcile(documentPath, `${image}\n\n${retained}`, retained);
        expect(await readFile(file)).toEqual(bytes);
      }
    });
  });

  it('does not sweep other files from an assets folder', async () => {
    await fixture(async ({ documentPath, directory, file, assets }) => {
      await writeFile(path.join(directory, 'keep.txt'), 'keep');
      await writeFile(path.join(directory, 'unused.png'), bytes);
      await assets.reconcile(documentPath, image, '');
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(directory)).sort()).toEqual(['keep.txt', 'unused.png']);
    });
  });

  it('never deletes outside the current document assets directory', async () => {
    await fixture(async ({ root, documentPath, file, assets }) => {
      const other = path.join(root, 'external.png');
      await writeFile(other, bytes);
      await assets.reconcile(documentPath, '![](external.png)\n![](../outside.png)\n![](https://example.com/a.png)', '');
      expect(await readFile(other)).toEqual(bytes);
      expect(await readFile(file)).toEqual(bytes);
    });
  });

  it('ignores code samples when deciding whether a displayed image has remaining references', async () => {
    await fixture(async ({ documentPath, directory, assets }) => {
      await assets.reconcile(documentPath, image, `\`\`\`md\n${image}\n\`\`\``);
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('reserves deleted names so a new paste cannot prevent undo restoration', async () => {
    await fixture(async ({ documentPath, file, assets }) => {
      await assets.reconcile(documentPath, image, '');
      const pasted = await savePastedImage({ documentPath, dataUrl, preferredName: 'image' });
      expect(path.basename(pasted.filePath)).toBe('image-1.png');
      await assets.reconcile(documentPath, '', image);
      expect(await readFile(file)).toEqual(bytes);
      expect(await readFile(pasted.filePath)).toEqual(bytes);
    });
  });

  it('serializes rapid delete, undo and redo operations', async () => {
    await fixture(async ({ documentPath, directory, assets }) => {
      await Promise.all([assets.reconcile(documentPath, image, ''), assets.reconcile(documentPath, '', image), assets.reconcile(documentPath, image, '')]);
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      await assets.reconcile(documentPath, '', image);
      expect(await readdir(directory)).toEqual(['image.png']);
    });
  });

  it.skipIf(process.platform === 'win32')('rejects a substituted symlinked assets directory', async () => {
    await fixture(async ({ root, documentPath, directory, assets }) => {
      const outside = path.join(root, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'image.png'), bytes);
      await rm(directory, { recursive: true });
      await symlink(outside, directory, 'dir');
      await expect(assets.reconcile(documentPath, image, '')).rejects.toThrow('symbolic link');
      expect(await readFile(path.join(outside, 'image.png'))).toEqual(bytes);
    });
  });
});
