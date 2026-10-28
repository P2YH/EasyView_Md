/** Install the actual tgz outside the checkout, then exercise it in real DSH. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url)), run = promisify(execFile);
if (!process.env.npm_execpath || !process.env.DSH_TEST_RUNTIME) throw new Error('Run npm run test:package with DSH_TEST_RUNTIME set');
const artifact = JSON.parse(await readFile(resolve(root, 'artifacts/development-package.json'), 'utf8'));
const tgz = resolve(root, 'artifacts', artifact.filename);
if (createHash('sha256').update(await readFile(tgz)).digest('hex') !== artifact.sha256) throw new Error('Package hash mismatch');
if (artifact.files.some(file => !/^(lib\/|README\.md$|LICENSE\.txt$|package\.json$|cordis\.patch\.yml$)/.test(file.path))) throw new Error('Unexpected files in development package');
const prefix = await mkdtemp(resolve(tmpdir(), 'easyview-installed-package-'));
await writeFile(resolve(prefix, 'package.json'), JSON.stringify({ name: 'isolated-easyview-install', version: '0.0.0', private: true, type: 'module' }) + '\n');
const installationRoot = resolve(prefix, 'node_modules/dsh-plugin-easyview');
let result = { status: 'running', artifact: artifact.filename, sha256: artifact.sha256, prefix, installationRoot,
  limitation: 'Uses this machine’s npm cache and DSH checkout. This is development-package validation, not the offline distribution/installed DSH release gate.' };
try {
  const installed = await run(process.execPath, [process.env.npm_execpath, 'install', '--ignore-scripts', '--omit=dev', '--offline', '--no-audit', '--no-fund', tgz],
    { cwd: prefix, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(resolve(root, 'docs/evidence/package-install.log'), installed.stdout + installed.stderr);
  const manifest = JSON.parse(await readFile(resolve(installationRoot, 'lib/workbench/asset-manifest.json'), 'utf8'));
  const host = await readFile(resolve(installationRoot, 'lib/index.js'), 'utf8');
  if (host.includes('C:\\workspace\\dsh\\EasyView_Md-dsh') || host.includes('C:/workspace/dsh/EasyView_Md-dsh')) throw new Error('Development checkout leaked into runtime bundle');
  result = { ...result, assets: manifest.files.length, installedVersion: JSON.parse(await readFile(resolve(installationRoot, 'package.json'), 'utf8')).version,
    nativeDependency: JSON.parse(await readFile(resolve(prefix, 'node_modules/koffi/package.json'), 'utf8')).version };
  const probe = await run(process.execPath, ['scripts/probe-dsh.mjs'], { cwd: root, env: { ...process.env, DSH_EASYVIEW_PACKAGE_ROOT: installationRoot },
    windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 240_000 });
  await writeFile(resolve(root, 'docs/evidence/package-dsh.log'), (probe.stdout + probe.stderr).replace(/(token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'));
  const evidence = JSON.parse(await readFile(resolve(root, 'docs/evidence/e00-package-probe.json'), 'utf8'));
  if (evidence.status !== 'passed' || evidence.installationRoot !== installationRoot) throw new Error('Installed package probe did not pass');
  if (!evidence.resourceNetwork?.publicNetworkDenied || evidence.resourceNetwork.blockedExternalRequests.length
    || !['pdf', 'pptx', 'png'].every(format => evidence.previews?.some(item => item.format === format && item.rendered && item.originalUnchanged))) {
    throw new Error('Installed package basic preview/resource probe did not pass');
  }
  const controlled = await run(process.execPath, ['scripts/probe-ai-controlled.mjs'], { cwd: root, env: { ...process.env, DSH_EASYVIEW_PACKAGE_ROOT: installationRoot },
    windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
  await writeFile(resolve(root, 'docs/evidence/package-ai.log'), controlled.stdout + controlled.stderr);
  const aiEvidence = JSON.parse(await readFile(resolve(root, 'docs/evidence/e05-package-controlled-ai.json'), 'utf8'));
  if (aiEvidence.status !== 'passed' || aiEvidence.installationRoot !== installationRoot || !aiEvidence.xlsx.exactUndoBytes) throw new Error('Installed package controlled AI probe did not pass');
  result = { ...result, status: 'passed', realDsh: true, originalSourceRequiredAtRuntime: false, controlledAiOriginalUi: true, xlsxProposalUndo: true,
    previews: ['pdf', 'pptx', 'png'], basicPathsWithoutPublicNetwork: true };
} catch (error) {
  result = { ...result, status: 'failed', error: error.message };
  process.exitCode = 1;
} finally {
  await writeFile(resolve(root, 'docs/evidence/development-package-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
