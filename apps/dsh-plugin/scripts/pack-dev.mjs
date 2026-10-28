/** Reviewable development artifact. Offline/release acceptance remains a separate gate. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
if (!process.env.npm_execpath) throw new Error('Run npm run pack:dev --workspace dsh-plugin-easyview');
await readFile(resolve(root, 'lib/workbench/asset-manifest.json'));
const { stdout } = await promisify(execFile)(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', artifacts],
  { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const [packed] = JSON.parse(stdout); const path = resolve(artifacts, packed.filename);
const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
const manifest = { status: 'development-only', name: packed.name, version: packed.version, filename: packed.filename,
  sha256, size: packed.size, files: packed.files, requiredExternalDependencies: ['koffi@3.1.1', 'exceljs@4.4.0'], peer: '@deepseek-ai/cordis ~4.0.5 (provided by DSH)',
  releaseGates: { E05: 'see docs/evidence for controlled UI and installed Desktop real-GPT results; remaining lifecycle/format cases pending', E06: 'not passed', E07: 'in progress; Office navigation/theme integrated per user request, full business regression pending', E08: 'not passed' } };
await writeFile(resolve(artifacts, 'development-package.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(artifacts, `${packed.filename}.sha256`), `${sha256}  ${packed.filename}\n`);
console.log(JSON.stringify({ status: manifest.status, path, sha256, packedFiles: packed.files.length, size: packed.size }, null, 2));
