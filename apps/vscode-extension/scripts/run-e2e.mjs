#!/usr/bin/env node
/**
 * VS Code extension e2e (layer 2): the vscode-test suites (e2e/*.test.js) and the Playwright
 * suites (e2e/*.spec.ts), all against one VS Code build.
 * VS Code: $VSCODE_EXECUTABLE_PATH, else the local macOS install, else a downloaded stable build.
 * Assumes `npm run build --workspace easyview-md` already ran. On Linux run under xvfb-run.
 * Usage: node scripts/run-e2e.mjs [--only=vscode-test|playwright]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);

async function resolveVsCode() {
  if (process.env.VSCODE_EXECUTABLE_PATH) return process.env.VSCODE_EXECUTABLE_PATH;
  const mac = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
  if (process.platform === 'darwin' && existsSync(mac)) return mac;
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
  return downloadAndUnzipVSCode({ version: 'stable', cachePath: path.join(root, '.vscode-test') });
}

const executable = await resolveVsCode();
console.log(`[e2e] VS Code: ${executable}`);
const env = { ...process.env, VSCODE_EXECUTABLE_PATH: executable };
// Run the CLIs through node so a missing exec bit on node_modules/.bin can't break the run.
const require = createRequire(import.meta.url);
const bin = (pkg, file) => {
  for (const dir of require.resolve.paths(pkg) ?? []) { const candidate = path.join(dir, pkg, file); if (existsSync(candidate)) return candidate; }
  throw new Error(`Cannot find ${pkg}/${file}`);
};
const steps = [
  ['vscode-test', [bin('@vscode/test-cli', 'out/bin.mjs'), '--config', '.vscode-test.mjs']],
  ['playwright', [bin('@playwright/test', 'cli.js'), 'test', '-c', 'playwright.e2e.config.ts']],
].filter(([name]) => !only || only === name);
let failed = false;
for (const [name, args] of steps) {
  console.log(`[e2e] ${name}: node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) { console.error(`[e2e] ${name} failed (${result.status ?? result.signal})`); failed = true; }
}
process.exit(failed ? 1 : 0);
