import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { fingerprintFiles } from './file-fingerprint';

it('fingerprints large files, symlinks and missing entries in input order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'easyview-fingerprint-'));
  try {
    const file = path.join(root, 'large'), link = path.join(root, 'link');
    const data = Buffer.alloc(2 * 1024 * 1024, 17);
    await writeFile(file, data); await symlink('large', link);
    expect(await fingerprintFiles([file, link, path.join(root, 'missing')])).toEqual([createHash('sha256').update(data).digest('hex'), 'link:large', 'missing']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
