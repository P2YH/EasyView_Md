// Generates the Microsoft Store (AppX/MSIX) tile assets consumed by
// electron-builder from apps/desktop/build/appx/ (its default appx assets dir).
// Source is the shared brand logo, same as tooling/brand/generate-icons.mjs.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') throw new Error('AppX asset generation currently requires macOS sips.');
const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'resources/brand/logo.png');
const outputDir = path.join(root, 'apps/desktop/build/appx');
// The logo is an opaque square on a white background; pad wide tiles with the
// same white so they match appx.backgroundColor in electron-builder.store.cjs.
const padColor = 'FFFFFF';

const square = [
  [50, 'StoreLogo.png'],
  [44, 'Square44x44Logo.png'],
  [71, 'SmallTile.png'],
  [150, 'Square150x150Logo.png'],
  [310, 'LargeTile.png'],
];
// [width, height, name]
const wide = [
  [310, 150, 'Wide310x150Logo.png'],
  [620, 300, 'SplashScreen.png'],
];

await mkdir(outputDir, { recursive: true });
const sips = (...args) => execFileAsync('/usr/bin/sips', args);
for (const [size, name] of square) {
  await sips('-s', 'format', 'png', '-z', String(size), String(size), source, '--out', path.join(outputDir, name));
}
const temp = await mkdtemp(path.join(os.tmpdir(), 'easyview-appx-'));
for (const [width, height, name] of wide) {
  const scaled = path.join(temp, `${name}.square.png`);
  await sips('-s', 'format', 'png', '-z', String(height), String(height), source, '--out', scaled);
  await sips('--padToHeightWidth', String(height), String(width), '--padColor', padColor, scaled, '--out', path.join(outputDir, name));
}
await rm(temp, { recursive: true, force: true });
console.log(`generated AppX assets in ${path.relative(root, outputDir)}`);
