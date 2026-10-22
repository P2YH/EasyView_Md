import { cpSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * `样例文件/` (repo root) holds the realistic sample documents, in 中文 and English, that every
 * test run may use instead of building files from scratch.
 * The owner keeps editing these files: tests copy them into a temporary workspace, never write
 * to the originals, and assert behaviour (opens, renders, no error) rather than exact content.
 * Exact-content and rare-format fixtures stay in `tests/fixtures/preview/`.
 */
export const SAMPLE_FILES_DIR = path.resolve(__dirname, '../../样例文件');

const isHidden = (name: string) => name.startsWith('.');

/** Copies the sample tree (including hidden `.x.assets` image folders, excluding `.git`/`.DS_Store`). */
export function copySampleFiles(target: string): void {
  cpSync(SAMPLE_FILES_DIR, target, {
    recursive: true,
    filter: (source) => !['.git', '.DS_Store'].includes(path.basename(source)),
  });
}

/** Every visible sample file, as a POSIX path relative to `样例文件/`. */
export function listSampleFiles(directory = SAMPLE_FILES_DIR, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !isHidden(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => entry.isDirectory()
      ? listSampleFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]);
}
