// Builds the unsigned Microsoft Store package (AppX/MSIX) from the Electron
// Forge output. Run after `npm run make` on Windows:
//   npm run make:appx --workspace @easyview/desktop
// `--check` only loads and validates the electron-builder config (any OS).
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = require(path.join(appDir, 'electron-builder.store.cjs'));
const version = require(path.join(appDir, 'package.json')).version;
const checkOnly = process.argv.includes('--check');

// Store packages are re-signed by Partner Center; a self-signed/third-party
// signature here would only get in the way of submission.
for (const name of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_NAME']) {
  if (process.env[name]) throw new Error(`${name} is set; the Store AppX must be built unsigned.`);
}
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
const { DebugLogger } = require('builder-util');
await validateConfiguration(config, new DebugLogger(false));
console.log(`electron-builder Store config OK (${config.appx.identityName}, ${config.appx.publisher}, v${version})`);
if (checkOnly) process.exit(0);

if (process.platform !== 'win32') throw new Error('AppX can only be built on Windows (needs makeappx from the Windows SDK).');
const prepackaged = path.join(appDir, 'out', 'EasyView_Md-win32-x64');
const exe = path.join(prepackaged, `${config.executableName}.exe`);
if (!statSync(exe).isFile()) throw new Error(`Missing Forge output ${exe}; run \`npm run make\` first.`);

const { build, Platform, Arch } = require('electron-builder');
await build({
  projectDir: appDir,
  prepackaged,
  targets: Platform.WINDOWS.createTarget('appx', Arch.x64),
  config,
  publish: 'never',
});

const artifact = path.join(appDir, config.directories.output, 'EasyView_Md-win-x64-store.appx');
const info = statSync(artifact);
if (!info.isFile() || !info.size) throw new Error(`Missing or empty Store package: ${artifact}`);
console.log(`Store package: ${path.relative(appDir, artifact)} (${info.size} bytes)`);
