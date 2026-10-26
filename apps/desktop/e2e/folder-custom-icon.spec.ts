import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('folder context customize icon picker applies and resets', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-folder-icon-')));
  const workspace = join(temporaryDirectory, 'icon-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  await mkdir(join(workspace, 'docs'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n', 'utf8');
  await writeFile(join(workspace, 'docs', 'guide.md'), '# Guide\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: [''],
      explorerVisible: true,
      outlineVisible: false,
      explorerWidth: 280,
      outlineWidth: 280,
    },
  }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    await expect(page.locator('.workspace-entry[data-relative-path="docs"]')).toHaveCount(1);

    await application.evaluate(({ BrowserWindow }, relativePath) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no window');
      win.webContents.send('workspace.contextCommand', 'customizeIcon', relativePath);
    }, 'docs');

    const overlay = page.locator('.folder-icon-picker-overlay');
    const dialog = page.locator('.folder-icon-picker-dialog');
    await expect(overlay).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.folder-icon-picker-title')).toContainText(/自定义文件夹图标|Customize Folder Icon/);

    const tabs = page.locator('.folder-icon-picker-tab');
    await expect(tabs).toHaveCount(10);
    await expect(tabs.first()).toHaveClass(/active/);
    await expect(tabs.first()).toHaveText(/默认|Default/);
    // Uncustomized folder: Default tile is selected
    await expect(page.locator('.folder-icon-picker-tile.selected')).toHaveCount(1);
    await expect(page.locator('.folder-icon-picker-tile')).toHaveCount(1);

    // Switch through a few tabs and ensure grids render
    for (const label of ['Flat', 'macOS', 'Lunar', 'Valentine']) {
      await tabs.filter({ hasText: new RegExp(`^${label}$`) }).click();
      await expect(page.locator('.folder-icon-picker-tab.active')).toHaveText(label);
      await expect(page.locator('.folder-icon-picker-tile')).toHaveCount(14);
    }

    await page.screenshot({ path: join(appDir, '../../test-results/folder-icon-picker.png') });

    // Select first tile under Valentine
    await page.locator('.folder-icon-picker-tile').first().click();
    await expect(overlay).toHaveCount(0);

    // Icon markup should appear on the docs folder entry
    const docsEntry = page.locator('.workspace-entry[data-relative-path="docs"]');
    await expect(docsEntry.locator('svg')).toHaveCount(1, { timeout: 5000 });
    await page.screenshot({ path: join(appDir, '../../test-results/folder-icon-applied.png') });

    // Persist: reopen picker via command and reset
    await application.evaluate(({ BrowserWindow }, relativePath) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no window');
      win.webContents.send('workspace.contextCommand', 'customizeIcon', relativePath);
    }, 'docs');
    await expect(overlay).toBeVisible();
    await page.locator('.folder-icon-picker-reset').click();
    await expect(overlay).toHaveCount(0);
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
