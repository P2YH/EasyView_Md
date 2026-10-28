/** Build the original EasyView renderer and its assets, without Electron/preload/main. */
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssInjectPlugin } from '../../../packages/preview-ui/esbuild-css-inject.mjs';
import { spreadsheetLifecyclePlugin } from '../../../packages/preview-ui/esbuild-spreadsheet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = resolve(root, '../..');
const desktop = resolve(workspace, 'packages/workbench-core/src/renderer');
const outdir = resolve(root, 'lib/workbench');
if (relative(root, outdir).replaceAll('\\', '/') !== 'lib/workbench') throw new Error('Invalid generated workbench directory');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const common = { bundle: true, platform: 'browser', target: 'chrome128', logLevel: 'info' };
await build({ ...common, entryPoints: {
  renderer: resolve(root, 'src/frame/bootstrap.ts'),
  'workers/doc-worker': resolve(desktop, 'preview/workers/doc-worker.ts'),
}, outdir, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
  format: 'esm', splitting: true, plugins: [spreadsheetLifecyclePlugin(), cssInjectPlugin()],
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl' } });
for (const [entry, filename] of [
  ['packages/editor-core/src/timeline/history-diff-worker.ts', 'history-diff-worker.js'],
  ['packages/preview-ui/src/workers/spreadsheet-worker.ts', 'workers/spreadsheet-worker.js'],
  ['packages/workbench-core/src/renderer/preview/heic-host.ts', 'heic-host.js'],
]) await build({ ...common, entryPoints: [resolve(workspace, entry)], outfile: resolve(outdir, filename), format: 'iife' });
for (const [source, target] of [
  [resolve(desktop, 'index.html'), 'index.html'], [resolve(desktop, 'desktop.css'), 'desktop.css'],
  [resolve(workspace, 'packages/editor-core/src/webview.css'), 'webview.css'],
  [resolve(workspace, 'packages/preview-ui/src/preview.css'), 'preview.css'],
  [resolve(workspace, 'resources/editor/styles/xterm.css'), 'xterm.css'],
]) await cp(source, resolve(outdir, target));
// Keep the upstream shell intact; the host palette is opt-in via Factory props.
await writeFile(resolve(outdir, 'desktop.css'), (await readFile(resolve(outdir, 'desktop.css'), 'utf8'))
  + '\n' + await readFile(resolve(root, 'src/frame/office-theme.css'), 'utf8'));
await mkdir(resolve(outdir, 'fonts'), { recursive: true });
for (const font of ['SourceHanSansCN-Normal.otf', 'SourceHanSansCN-Heavy.otf', 'NotoSansSymbols2-Regular.ttf']) {
  await cp(resolve(workspace, 'resources/editor/fonts', font), resolve(outdir, 'fonts', font));
}
for (const [source, target] of [['inter-latin-wght-normal.woff2', 'Inter.var.woff2'], ['inter-latin-wght-italic.woff2', 'Inter-italic.var.woff2']]) {
  await cp(resolve(workspace, 'node_modules/@fontsource-variable/inter/files', source), resolve(outdir, 'fonts', target));
}
await promisify(execFile)(process.execPath, [resolve(workspace, 'node_modules/file-viewer-copy-assets/dist/cli.js'),
  resolve(outdir, 'vendor/file-viewer'), '--renderers', 'pdf,office-word-openxml,office-presentation-binary,office-presentation,spreadsheet-openxml,archive,photoshop-design,drawing']);
await mkdir(resolve(outdir, 'vendor/file-viewer-ppt'), { recursive: true });
for (const asset of ['ppt-native.wasm', 'ppt-font-cjk.otf', 'worker.mjs', 'frame-cache.mjs', 'LICENSE', 'NOTICE', 'manifest.json']) {
  await cp(resolve(workspace, 'node_modules/@file-viewer/ppt', asset), resolve(outdir, 'vendor/file-viewer-ppt', asset));
}
const heicScript = (await readFile(resolve(outdir, 'heic-host.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
const heicHash = createHash('sha256').update(heicScript).digest('base64');
await writeFile(resolve(outdir, 'heic-host.html'), (await readFile(resolve(desktop, 'preview/heic-host.html'), 'utf8'))
  .replace("script-src 'self'", `script-src 'sha256-${heicHash}'`).replace('<script src="./heic-host.js"></script>', () => `<script>${heicScript}</script>`));
const files = (await readdir(outdir, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
  .map(entry => relative(outdir, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter(name => name !== 'asset-manifest.json');
await writeFile(resolve(outdir, 'asset-manifest.json'), JSON.stringify({ upstreamSha: '2400d66d2f8458822f895240b5389fee5bd8006d', files }, null, 2) + '\n');
console.log(`Built original EasyView shell probe and ${files.length} assets. Editing and AI acceptance remain pending.`);
