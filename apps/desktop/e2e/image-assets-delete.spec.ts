import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function missing(filePath: string) { return stat(filePath).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; }); }
async function images(page: Page, count: number) {
  const locator = page.locator('.desktop-editor-session:not([hidden]) #editor .image-view-wrapper img');
  await expect(locator).toHaveCount(count);
  await expect.poll(() => locator.evaluateAll(elements => elements.every(element => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
}
async function deleteFirstImage(page: Page) {
  await page.locator('#editor .image-view-wrapper').first().click();
  await page.locator('.image-toolbar:visible button[title="删除图片"]').click();
}
async function toggleSource(application: ElectronApplication) {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop.menuCommand', 'toggleSourceMode'));
}

test('deletes asset files and empty folders across toolbar/source, undo/redo, discard and save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'easyview-delete-image-assets-'));
  const userData = join(directory, 'profile');
  const documentPath = join(directory, 'notes.md');
  const assets = join(directory, '.notes.assets');
  const imagePath = join(assets, 'image.png');
  const reference = '![](.notes.assets/image.png)';
  const png = new PNG({ width: 8, height: 8 }); png.data.fill(255);
  const bytes = PNG.sync.write(png);
  await mkdir(userData); await mkdir(assets);
  await writeFile(imagePath, bytes);
  await writeFile(documentPath, `# Assets\n\n${reference}\n\n${reference}\n`);
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [documentPath], workspace: { rootPath: directory,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: documentPath }], activeTabId: 'notes-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 280, outlineWidth: 280 },
  }));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    let page = await application.firstWindow();
    await resumeRestoredSession(page);
    await images(page, 2);
    await deleteFirstImage(page);
    await images(page, 1);
    expect(await readFile(imagePath)).toEqual(bytes);
    await deleteFirstImage(page);
    await images(page, 0);
    await expect.poll(() => missing(assets)).toBe(true);

    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(() => missing(imagePath)).toBe(false);
    await images(page, 1);
    expect(await readFile(imagePath)).toEqual(bytes);
    await page.keyboard.press(`${modifier}+Shift+z`);
    await images(page, 0);
    await expect.poll(() => missing(assets)).toBe(true);
    await page.keyboard.press(`${modifier}+z`);
    await images(page, 1);
    await toggleSource(application);
    const source = page.locator('.cm-content');
    await expect(source).toBeVisible();
    await source.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('# No images');
    await expect.poll(() => missing(assets)).toBe(true);
    await page.keyboard.press(`${modifier}+z`);
    await expect(source).toContainText(reference);
    await expect.poll(() => missing(imagePath)).toBe(false);
    await toggleSource(application);
    await images(page, 1);
    await page.keyboard.press(`${modifier}+s`);
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).split(reference).length - 1).toBe(1);
    const saved = await readFile(documentPath, 'utf8');

    // Discarding unsaved image deletion must restore the file still referenced on disk.
    await toggleSource(application);
    await expect(source).toBeVisible();
    await source.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('# Discard deletion');
    await expect.poll(() => missing(assets)).toBe(true);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await page.locator('.desktop-tab-close').click();
    await expect.poll(() => missing(imagePath)).toBe(false);
    expect(await readFile(documentPath, 'utf8')).toBe(saved);
    await page.evaluate(async () => {
      await (window as unknown as { easyViewDesktop: { tabs: { openWorkspaceEntry(path: string): Promise<unknown> } } }).easyViewDesktop.tabs.openWorkspaceEntry('notes.md');
    });
    await images(page, 1);
    await deleteFirstImage(page);
    await expect.poll(() => missing(assets)).toBe(true);
    await page.keyboard.press(`${modifier}+s`);
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).includes('.notes.assets')).toBe(false);
    await terminateElectron(application); application = undefined;
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    page = await application.firstWindow(); await resumeRestoredSession(page);
    await images(page, 0);
    expect(await missing(assets)).toBe(true);
  } finally { await terminateElectron(application); await rm(directory, { recursive: true, force: true }); }
});
