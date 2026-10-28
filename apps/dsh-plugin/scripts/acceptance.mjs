// Local verification commands are executable; none substitutes for full E06 acceptance.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const gate = process.argv[2];
async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`Verification failed: ${args.join(' ')}`);
}
try {
  if (gate === 'integration') {
    const tests = (await readdir(new URL('../tests/', import.meta.url))).filter(file => file.endsWith('.test.mjs')).map(file => `tests/${file}`);
    await run(['--import', 'tsx/esm', '--test', ...tests]); await run(['scripts/probe-viewers.mjs']); await run(['scripts/probe-ai-controlled.mjs']);
    console.log('Local integration checks passed. E06, AI, portal and offline acceptance remain pending.');
  } else if (gate === 'dsh') await run(['scripts/probe-dsh.mjs']);
  else throw new Error(`${gate} acceptance is blocked: the isolated profile has no available model; real-model MD/Chat and XLSX proposal/new-file flows remain unaccepted. Controlled UI tests do not replace E05. See docs/agent-progress.md.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
