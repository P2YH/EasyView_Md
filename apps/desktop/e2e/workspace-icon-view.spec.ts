import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('explorer can switch between list and icon views and browse folders as icons', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-icons-')));
  const workspace = join(temporaryDirectory, 'icon-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  await mkdir(join(workspace, 'docs', 'sub'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n', 'utf8');
  await writeFile(join(workspace, 'docs', 'guide.md'), '# Guide body\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 280,
    },
  }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    await expect(page.locator('.workspace-entry')).toHaveCount(2);
    const header = page.locator('.workspace-header');
    await expect(header.getByRole('img', { name: '目录树' })).toHaveAttribute('title', '目录树');
    await expect(header.locator('.workspace-header-title')).toHaveText('icon-workspace');
    await header.screenshot({ path: join(appDir, '../../test-results/desktop-workspace-header.png') });

    await page.locator('.workspace-settings-toggle').click();
    const dialog = page.getByRole('dialog', { name: '文件面板设置' });
    await expect(dialog).toBeFocused();
    const dialogBox = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(Math.abs((dialogBox!.x + dialogBox!.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((dialogBox!.y + dialogBox!.height / 2) - viewport.height / 2)).toBeLessThanOrEqual(1);
    expect(dialogBox!.width).toBeGreaterThan(dialogBox!.height);
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-workspace-menu.png') });
    const iconsChoice = dialog.getByRole('radio', { name: '图标' });
    const save = dialog.getByRole('button', { name: '保存' });
    await expect(dialog.getByRole('radio', { name: '列表' })).toHaveAttribute('aria-checked', 'true');
    await iconsChoice.click();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.workspace-entry')).toHaveCount(2);

    await page.locator('.workspace-settings-toggle').click();
    await iconsChoice.click();
    await save.click();
    await expect(dialog).toHaveCount(0);

    const tiles = page.locator('.workspace-icon-tile');
    await expect(page.locator('.workspace-entry')).toHaveCount(0);
    await expect(tiles).toHaveCount(2);
    await expect(page.locator('.workspace-icon-back')).toBeDisabled();
    await expect(page.locator('.workspace-icon-path')).toHaveText('icon-workspace');
    await expect(page.locator('.workspace-icon-tile[data-relative-path="notes.md"]')).toHaveClass(/active/);

    await page.locator('.workspace-icon-tile[data-relative-path="docs"]').dblclick();
    await expect(page.locator('.workspace-icon-path')).toHaveText('docs');
    await expect(tiles).toHaveCount(2);
    await expect(page.locator('.workspace-icon-tile[data-relative-path="docs/sub"]')).toHaveCount(1);
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-workspace-icons.png') });

    await page.locator('.workspace-icon-tile[data-relative-path="docs/guide.md"]').dblclick();
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
    await expect(page.locator('.ProseMirror').filter({ visible: true })).toContainText('Guide body');
    await expect(page.locator('.workspace-icon-tile[data-relative-path="docs/guide.md"]')).toHaveClass(/selected/);

    await page.locator('.workspace-icon-tile[data-relative-path="docs/sub"]').dblclick();
    await expect(page.locator('.workspace-icon-empty')).toHaveText('文件夹为空');
    await page.locator('.workspace-icon-back').click();
    await expect(page.locator('.workspace-icon-path')).toHaveText('docs');

    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(join(userData, 'desktop-state.json'), 'utf8'));
      return [saved.workspace?.explorerDisplayMode, saved.workspace?.explorerIconDirectory];
    }).toEqual(['icons', 'docs']);

    await page.locator('.workspace-settings-toggle').click();
    await dialog.getByRole('radio', { name: '列表' }).click();
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.workspace-icon-tile')).toHaveCount(0);
    await expect(page.locator('.workspace-entry[data-relative-path="docs"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.workspace-entry[data-relative-path="docs/guide.md"]')).toHaveCount(1);

    const entryFontSize = () => page.locator('.workspace-entry[data-relative-path="notes.md"] .workspace-entry-name')
      .evaluate((element) => getComputedStyle(element).fontSize);
    await expect.poll(entryFontSize).toBe('16px');
    await page.locator('.workspace-settings-toggle').click();
    const fontValue = dialog.locator('.easyview-settings-stepper-value');
    await expect(fontValue).toHaveText('16px');
    await dialog.getByRole('button', { name: '增大字号' }).click();
    await dialog.getByRole('button', { name: '增大字号' }).click();
    await expect(fontValue).toHaveText('18px');
    await expect.poll(entryFontSize).toBe('16px');
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-workspace-font-size.png') });
    await save.click();
    await expect.poll(entryFontSize).toBe('18px');

    await page.reload();
    await resumeRestoredSession(page);
    await expect.poll(entryFontSize).toBe('18px');
    await page.locator('.workspace-settings-toggle').click();
    await dialog.getByRole('button', { name: '恢复默认' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(entryFontSize).toBe('18px');
    await page.locator('.workspace-settings-toggle').click();
    await dialog.getByRole('button', { name: '恢复默认' }).click();
    await save.click();
    await expect.poll(entryFontSize).toBe('16px');
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
