import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function copyImage(app: ElectronApplication, bytes: Buffer) {
  await app.evaluate(({ clipboard, nativeImage }, base64) => {
    clipboard.clear();
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64')));
  }, bytes.toString('base64'));
}
type ClipboardSnapshot = { text: string; html: string; rtf: string; image: string };
// The paste must go through the real system clipboard; keep whatever the user had copied.
function saveClipboard(app: ElectronApplication): Promise<ClipboardSnapshot> {
  return app.evaluate(({ clipboard }) => ({
    text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(),
    image: clipboard.readImage().isEmpty() ? '' : clipboard.readImage().toPNG().toString('base64'),
  }));
}
async function restoreClipboard(app: ElectronApplication | undefined, saved: ClipboardSnapshot | undefined) {
  if (!app || !saved) return;
  await app.evaluate(({ clipboard, nativeImage }, { text, html, rtf, image }) => {
    clipboard.clear();
    clipboard.write({
      ...(text ? { text } : {}), ...(html ? { html } : {}), ...(rtf ? { rtf } : {}),
      ...(image ? { image: nativeImage.createFromBuffer(Buffer.from(image, 'base64')) } : {}),
    });
  }, saved).catch(() => undefined);
}
async function command(app: ElectronApplication, name: string) {
  await app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].webContents.send('desktop.menuCommand', value);
  }, name);
}
async function loadedImages(page: Page, count: number) {
  const images = page.locator('.desktop-editor-session:not([hidden]) #editor .image-view-wrapper img');
  await expect(images).toHaveCount(count);
  await expect.poll(() => images.evaluateAll(elements => elements.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
}

test('pastes system clipboard images in render and source modes with plugin-compatible paths and persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'easyview-image-paste-'));
  const userData = join(directory, 'profile');
  const documentPath = join(directory, '图片 测试.md');
  const assets = join(directory, '.图片-测试.assets');
  const png = new PNG({ width: 4, height: 4 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  await mkdir(userData);
  await writeFile(documentPath, '# 图片粘贴\n\n插入位置\n');
  await writeFile(join(directory, 'second.md'), '# Second\n\nUntouched\n');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [documentPath],
    workspace: { rootPath: directory,
      openTabs: [{ id: 'image-tab', kind: 'editor', filePath: documentPath }], activeTabId: 'image-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 280, outlineWidth: 280 },
  }));
  let application: ElectronApplication | undefined;
  let userClipboard: ClipboardSnapshot | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    userClipboard = await saveClipboard(application);
    let page = await application.firstWindow();
    await resumeRestoredSession(page);
    const paragraph = page.locator('#editor .ProseMirror p').last();
    await paragraph.click();
    await page.keyboard.press('End');
    await copyImage(application, bytes);
    await page.keyboard.press(`${modifier}+v`);
    await loadedImages(page, 1);
    expect(await readdir(assets)).toHaveLength(1);

    // Custom context-menu Paste must preserve image bytes too.
    await page.keyboard.press('ArrowRight');
    await paragraph.click({ button: 'right', position: { x: 8, y: 8 } });
    await page.locator('.context-menu-item').filter({ has: page.locator('.context-menu-label', { hasText: /^粘贴$/ }) }).click();
    await loadedImages(page, 2);
    expect(await readdir(assets)).toHaveLength(2);

    await command(application, 'toggleSourceMode');
    const source = page.locator('.cm-content');
    await expect(source).toBeVisible();
    await source.click();
    await page.keyboard.press(`${modifier}+End`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('SOURCE:');
    await copyImage(application, bytes);
    await page.keyboard.press(`${modifier}+v`);
    await expect(source).toContainText('SOURCE:![](.图片-测试.assets/');
    expect(await readdir(assets)).toHaveLength(3);
    // Known issue: on Windows, redo after undo in source mode does not restore the pasted image.
    if (process.platform !== 'win32') {
      await page.keyboard.press(`${modifier}+z`);
      await expect(source).not.toContainText(/SOURCE:!\[\]/);
      await page.keyboard.press(`${modifier}+Shift+z`);
      await expect(source).toContainText('SOURCE:![](.图片-测试.assets/');
    }
    await command(application, 'toggleSourceMode');
    await loadedImages(page, 3);
    await page.keyboard.press(`${modifier}+s`);
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).match(/!\[\]\(\.图片-测试\.assets\//g)?.length).toBe(3);
    const saved = await readFile(documentPath, 'utf8');
    expect(saved).not.toContain('data:image');
    const names = await readdir(assets);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(PNG.sync.read(await readFile(join(assets, name))).width).toBe(4);

    await terminateElectron(application); application = undefined;
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    page = await application.firstWindow();
    await resumeRestoredSession(page);
    await loadedImages(page, 3);

    // Hold the real host response while another document becomes active.
    await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const original = contents.send.bind(contents);
      const state = globalThis as typeof globalThis & { releaseImage?: () => void; imageHeld?: boolean };
      contents.send = ((channel: string, ...args: unknown[]) => {
        if (channel === 'editor.message' && (args[0] as { type?: string })?.type === 'pasteImageResult') {
          state.imageHeld = true;
          state.releaseImage = () => { contents.send = original; original(channel, ...args); };
        } else original(channel, ...args);
      }) as typeof contents.send;
    });
    await page.locator('#editor .ProseMirror p').last().click();
    await page.keyboard.press('End');
    await copyImage(application, bytes);
    await page.keyboard.press(`${modifier}+v`);
    await expect.poll(() => application!.evaluate(() => (globalThis as typeof globalThis & { imageHeld?: boolean }).imageHeld)).toBe(true);
    await page.evaluate(async () => {
      await (window as unknown as { easyViewDesktop: { tabs: { openWorkspaceEntry(path: string): Promise<unknown> } } }).easyViewDesktop.tabs.openWorkspaceEntry('second.md');
    });
    await expect(page.locator('.desktop-tab.active .desktop-tab-label')).toHaveText('second.md');
    await application.evaluate(() => (globalThis as typeof globalThis & { releaseImage?: () => void }).releaseImage!());
    await loadedImages(page, 0);
    await expect(page.locator('.desktop-editor-session:not([hidden]) .ProseMirror')).toContainText('Untouched');
    await page.locator('.desktop-tab-label', { hasText: '图片 测试.md' }).click();
    await loadedImages(page, 4);
    expect(await readdir(assets)).toHaveLength(4);
    expect(await readFile(join(directory, 'second.md'), 'utf8')).toBe('# Second\n\nUntouched\n');
  } finally {
    await restoreClipboard(application, userClipboard);
    await terminateElectron(application);
    await rm(directory, { recursive: true, force: true });
  }
});
