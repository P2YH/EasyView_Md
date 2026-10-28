/** Persist command evidence without turning partial checks into release acceptance. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), workspace = resolve(root, '../..');
if (!process.env.npm_execpath) throw new Error('Run npm run verify:local --workspace dsh-plugin-easyview');
const evidence = resolve(root, 'docs/evidence/local-checks'); await mkdir(evidence, { recursive: true });
const tests = (await readdir(resolve(root, 'tests'))).filter(file => file.endsWith('.test.mjs')).map(file => `tests/${file}`);
const steps = [
  ['plugin-types', workspace, [process.env.npm_execpath, 'run', 'typecheck', '--workspace', 'dsh-plugin-easyview']],
  ['desktop-types', workspace, [process.env.npm_execpath, 'run', 'typecheck', '--workspace', '@easyview/desktop']],
  ['workbench-types', workspace, [process.env.npm_execpath, 'run', 'typecheck', '--workspace', '@easyview/workbench-core']],
  ['plugin-build', workspace, [process.env.npm_execpath, 'run', 'build', '--workspace', 'dsh-plugin-easyview']],
  ['architecture', workspace, ['tooling/verify/check-architecture.mjs']],
  ['i18n', workspace, ['tooling/verify/check-i18n.mjs']],
  ['changed-lint', workspace, ['node_modules/oxlint/bin/oxlint', 'apps/dsh-plugin/src', 'packages/preview-ui/src/editorLifecycle.ts', 'packages/preview-ui/src/editorCheckpointQueue.ts', 'packages/preview-ui/src/viewers/DocViewer.ts', 'packages/editor-core/src/ui/AiChatPanel.ts', 'packages/workbench-core/src/renderer/workbench.ts']],
  ['host-tests', root, ['--import', 'tsx/esm', '--test', ...tests]],
  ['affected-tests', workspace, ['node_modules/vitest/vitest.mjs', 'run', 'packages/node-runtime/src/ai/xlsx-edit.test.ts', 'packages/contracts/src/ai/text-patch.test.ts', 'packages/preview-ui/src', 'packages/workbench-core/src', 'packages/editor-core/src/sync', 'packages/editor-core/src/ui/AiChatPanel.test.ts', 'packages/editor-core/src/ui/lazyAiChatPanel.test.ts']],
  ['upstream-app-state-isolated', workspace, ['node_modules/vitest/vitest.mjs', 'run', 'apps/desktop/src/main/application/document/appState.test.ts']],
  ['viewer-probe', root, ['scripts/probe-viewers.mjs']],
  ['controlled-ai-ui', root, ['scripts/probe-ai-controlled.mjs']],
  ['real-dsh-profile', root, ['scripts/probe-dsh.mjs']],
  ['desktop-build', workspace, [process.env.npm_execpath, 'run', 'build:desktop']],
];
const results = [];
for (const [id, cwd, args] of steps) {
  console.log(`Running ${id}`);
  const startedAt = new Date().toISOString(); let output = '';
  const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  // DSH's launch tokens are already redacted in the profile probe. Never retain
  // an unexpected launch token from another diagnostic process either.
  output = output.replace(/(token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]');
  const log = resolve(evidence, `${id}.log`); await writeFile(log, output);
  results.push({ id, startedAt, finishedAt: new Date().toISOString(), cwd, command: [process.execPath, ...args], exitCode: code, log });
  console.log(`${id}: ${code === 0 ? 'passed' : 'failed'} (exit ${code})`);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ status: results.every(result => result.exitCode === 0) ? 'passed-so-far' : 'failed', kind: 'local checks only; E06 remains pending', results }, null, 2) + '\n');
}
const passed = results.every(result => result.exitCode === 0);
await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', kind: 'local checks only; E06 remains pending', results }, null, 2) + '\n');
if (!passed) process.exitCode = 1;
