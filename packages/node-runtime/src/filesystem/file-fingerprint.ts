import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

/** Fixed-size buffers and sequential files keep fingerprinting independent of input size. */
export async function fingerprintFiles(paths: readonly string[]): Promise<string[]> {
  const fingerprints: string[] = [];
  for (const file of paths) {
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) {
        fingerprints.push(`link:${await fs.readlink(file)}`);
        continue;
      }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) hash.update(chunk);
      fingerprints.push(hash.digest('hex'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      fingerprints.push('missing');
    }
  }
  return fingerprints;
}
