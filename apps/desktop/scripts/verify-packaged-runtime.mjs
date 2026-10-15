import { _electron as electron, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(appDir, 'out', `EasyView_Md-${process.platform}-${process.arch}`);
const executablePath = process.platform === 'darwin'
  ? path.join(bundleRoot, 'EasyView_Md.app', 'Contents', 'MacOS', 'EasyView_Md')
  : path.join(bundleRoot, 'EasyView_Md.exe');
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'easyview-packaged-runtime-'));
const documentPath = path.join(tempDirectory, 'packaged-runtime.md');
const userDataDirectory = path.join(tempDirectory, 'user-data');
const logDirectory = path.join(tempDirectory, 'logs');
const diagnosticsDirectory = path.join(appDir, 'test-results', 'packaged-runtime');
const EDITOR_TIMEOUT_MS = 30_000;
const consoleLines = [];
await writeFile(documentPath, '# Packaged EasyView_Md\n\nRuntime check.\n', 'utf8');

const application = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${userDataDirectory}`, documentPath],
  env: { ...process.env, NODE_OPTIONS: '', EASYVIEW_DISABLE_UPDATE_CHECK: '1', EASYVIEW_LOG_DIR: logDirectory },
});

async function dumpDiagnostics(page, error) {
  console.error(`packaged runtime check failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  await mkdir(diagnosticsDirectory, { recursive: true }).catch(() => undefined);
  if (page) {
    await page.screenshot({ path: path.join(diagnosticsDirectory, 'failure.png'), timeout: 5_000 }).then(
      () => console.error(`screenshot: ${path.join(diagnosticsDirectory, 'failure.png')}`),
      (screenshotError) => console.error(`screenshot failed: ${String(screenshotError)}`),
    );
    const title = await page.title().catch(() => '<unknown>');
    console.error(`window title: ${title}`);
  }
  console.error(`--- renderer console (${consoleLines.length} lines) ---\n${consoleLines.join('\n')}`);
  const logFiles = await readdir(logDirectory).catch(() => []);
  for (const name of logFiles) {
    const text = await readFile(path.join(logDirectory, name), 'utf8').catch(() => '');
    console.error(`--- ${name} ---\n${text}`);
    await writeFile(path.join(diagnosticsDirectory, name), text).catch(() => undefined);
  }
  await writeFile(path.join(diagnosticsDirectory, 'renderer-console.log'), consoleLines.join('\n')).catch(() => undefined);
}

let page;

try {
  page = await application.firstWindow();
  page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (pageError) => consoleLines.push(`[pageerror] ${pageError.message}`));
  // Cold start of a freshly packaged app on CI runners (Windows Defender scans, asar unpack) can exceed 5s.
  await expect(page.locator('.ProseMirror')).toContainText('Packaged EasyView_Md', { timeout: EDITOR_TIMEOUT_MS });

  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('Alt+t');
  const terminal = page.locator('.easyview-terminal-modal');
  await expect(terminal).toBeVisible();
  const terminalInput = terminal.locator('.xterm-helper-textarea');
  await terminalInput.focus();
  await page.keyboard.type(
    process.platform === 'win32'
      ? 'echo EASYVIEW_PACKAGED_TERMINAL_OK'
      : 'printf EASYVIEW_PACKAGED_TERMINAL_OK',
  );
  await page.keyboard.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText(
    'EASYVIEW_PACKAGED_TERMINAL_OK',
    { timeout: 10_000 },
  );
  await terminal.locator('[data-action="close"]').click({ force: true });

  const paragraph = page.locator('.ProseMirror p').last();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Packaged saved.');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
  await expect.poll(async () => readFile(documentPath, 'utf8')).toContain(
    'Runtime check. Packaged saved.',
  );

  console.log(`verified packaged runtime ${executablePath}`);
} catch (error) {
  await dumpDiagnostics(page, error);
  throw error;
} finally {
  const applicationProcess = application.process();
  if (applicationProcess.exitCode === null) {
    const exited = once(applicationProcess, 'exit');
    applicationProcess.kill('SIGKILL');
    await exited;
  }
  await application.close();
  await rm(tempDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => undefined);
}
