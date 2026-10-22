import { _electron as electron, expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keepElectronInBackground, terminateElectron } from '../../desktop/e2e/support/electronApp';

/**
 * Runs the extension-host suites (e2e/*.test.js, Mocha TDD) inside a real VS Code launched by
 * Playwright, so local runs get the same background window treatment as the other specs.
 */
test('extension-host suites (e2e/*.test.js)', async () => {
  test.setTimeout(600_000);
  const executablePath = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('Set VSCODE_EXECUTABLE_PATH to the VS Code executable before running this test');
  const temporary = await mkdtemp(join(tmpdir(), 'easyview-vscode-e2e-')), workspace = join(temporary, 'workspace');
  await mkdir(workspace); await mkdir(join(temporary, 'data', 'User'), { recursive: true });
  await writeFile(join(temporary, 'data', 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none' }));
  const application = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${join(temporary, 'data')}`, `--extensions-dir=${join(temporary, 'extensions')}`,
      `--extensionDevelopmentPath=${resolve(__dirname, '..')}`,
      `--extensionTestsPath=${resolve(__dirname, 'support/extensionHostRunner.js')}`,
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', workspace,
    ],
    timeout: 60_000,
  });
  const child = application.process();
  const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
  child.stdout?.pipe(process.stdout); child.stderr?.pipe(process.stderr);
  try {
    await keepElectronInBackground(application);
    const [code] = await closed;
    expect(code, 'VS Code exit code (non-zero means a suite failed; see the Mocha output above)').toBe(0);
  } finally {
    await terminateElectron(application).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});
