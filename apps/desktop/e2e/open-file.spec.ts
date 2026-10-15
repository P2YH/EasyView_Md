import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminateElectron } from './support/electronApp';

const appDir = process.cwd();

async function emitOpenFile(application: ElectronApplication, filePath: string): Promise<void> {
  await application.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault() {} }, target);
  }, filePath);
}

test('system open requests reveal the document while running and rebuild the window after it closed', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-open-file-')));
  const userData = join(temporaryDirectory, 'user-data');
  const first = join(temporaryDirectory, 'first.md');
  const second = join(temporaryDirectory, 'second.md');
  await mkdir(userData, { recursive: true });
  await writeFile(first, '# First Document\n\nOne.\n', 'utf8');
  await writeFile(second, '# Second Document\n\nTwo.\n', 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`, first] });
    let page = await application.firstWindow();
    await expect(page.locator('.ProseMirror').filter({ visible: true })).toContainText('First Document');

    await emitOpenFile(application, second);
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
    await expect(page.locator('.ProseMirror').filter({ visible: true })).toContainText('Second Document');
    await expect(page.locator('#desktop-welcome')).toBeHidden();

    test.skip(process.platform !== 'darwin', 'Only macOS keeps the app alive without windows.');
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);

    const reopened = application.waitForEvent('window');
    await emitOpenFile(application, first);
    page = await reopened;
    await expect(page.locator('.ProseMirror').filter({ visible: true })).toContainText('First Document');
    await expect(page.locator('#desktop-welcome')).toBeHidden();
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
