#!/usr/bin/env node
/**
 * VS Code extension e2e (layer 2): Playwright drives a real VS Code for every suite (e2e/*.spec.ts);
 * extension-host.spec.ts runs the in-host Mocha suites (e2e/*.test.js) the same way.
 * VS Code: $VSCODE_EXECUTABLE_PATH, else the local macOS install, else a downloaded stable build.
 * Assumes `npm run build --workspace easyview-md` already ran. On Linux run under xvfb-run.
 * Usage: node scripts/run-e2e.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function resolveVsCode() {
  if (process.env.VSCODE_EXECUTABLE_PATH) return process.env.VSCODE_EXECUTABLE_PATH;
  // VS Code renamed its macOS executable from Electron to Code.
  const mac = ['Code', 'Electron'].map((name) => `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`).find(existsSync);
  if (process.platform === 'darwin' && mac) return mac;
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
  return downloadAndUnzipVSCode({ version: 'stable', cachePath: path.join(root, '.vscode-test') });
}

const executable = await resolveVsCode();
console.log(`[e2e] VS Code: ${executable}`);
const env = { ...process.env, VSCODE_EXECUTABLE_PATH: executable };
// Run the CLI through node so a missing exec bit on node_modules/.bin can't break the run.
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', '-c', 'playwright.e2e.config.ts'], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
