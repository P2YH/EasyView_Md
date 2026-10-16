// Builds the website Windows installer (NSIS wizard) from the Electron Forge
// output. Run after `npm run make` on Windows:
//   npm run make:nsis --workspace @easyview/desktop
// `--check` only loads and validates the electron-builder config (any OS).
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = require(path.join(appDir, 'electron-builder.nsis.cjs'));
const version = require(path.join(appDir, 'package.json')).version;
const checkOnly = process.argv.includes('--check');

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
const { DebugLogger } = require('builder-util');
await validateConfiguration(config, new DebugLogger(false));
for (const file of [config.nsis.include, config.nsis.installerIcon, config.nsis.uninstallerIcon]) {
  if (!statSync(path.join(appDir, file)).isFile()) throw new Error(`Missing NSIS resource ${file}`);
}
console.log(`electron-builder NSIS config OK (${config.appId}, v${version})`);
if (checkOnly) process.exit(0);

if (process.platform !== 'win32') throw new Error('The NSIS installer is built on Windows only.');
const prepackaged = path.join(appDir, 'out', 'EasyView_Md-win32-x64');
const exe = path.join(prepackaged, `${config.executableName}.exe`);
if (!statSync(exe).isFile()) throw new Error(`Missing Forge output ${exe}; run \`npm run make\` first.`);

const { build, Platform, Arch } = require('electron-builder');
await build({
  projectDir: appDir,
  prepackaged,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config,
  publish: 'never',
});

const artifact = path.join(appDir, config.directories.output, 'EasyView_Md-win-x64-setup.exe');
const info = statSync(artifact);
if (!info.isFile() || !info.size) throw new Error(`Missing or empty installer: ${artifact}`);
console.log(`Windows installer: ${path.relative(appDir, artifact)} (${info.size} bytes)`);
