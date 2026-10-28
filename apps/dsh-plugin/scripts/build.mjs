import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import './build-workbench.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'lib'), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/index.ts')], outfile: resolve(root, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['koffi', 'exceljs'] });
await build({ entryPoints: [resolve(root, 'src/ai-preset.ts')], outfile: resolve(root, 'lib/ai-preset.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const body = await readFile(resolve(root, 'src/client/index.cjs'), 'utf8');
await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({id:"dsh-plugin-easyview",factory:(require)=>{const module={exports:{}};\n${body}\nreturn module.exports;}});\n`);
try { await copyFile(resolve(root, '../../LICENSE.txt'), resolve(root, 'LICENSE.txt')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Built EasyView Host, lazy Client and original workbench.');
