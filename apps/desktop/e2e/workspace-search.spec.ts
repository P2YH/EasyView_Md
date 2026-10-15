import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('explorer search finds nested files and folders, opens files, and reveals folders', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-search-')));
  const workspace = join(temporaryDirectory, 'search-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  await mkdir(join(workspace, 'docs', 'deep', 'release-guide'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n', 'utf8');
  await writeFile(join(workspace, 'docs', 'deep', 'Setup-Guide.md'), '# Setup guide body\n', 'utf8');
  await writeFile(join(workspace, 'node_modules', 'pkg', 'guide.md'), '# Ignored\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 280, outlineWidth: 280,
    },
  }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    await expect(page.locator('.workspace-entry')).toHaveCount(3);

    await page.locator('.workspace-search-toggle').click();
    const input = page.locator('.workspace-search-input');
    await expect(input).toBeFocused();
    await input.fill('guide');
    const results = page.locator('.workspace-search-result');
    await expect(results).toHaveCount(2);
    await expect(results.nth(0)).toHaveAttribute('data-relative-path', 'docs/deep/release-guide');
    await expect(results.nth(1)).toHaveAttribute('data-relative-path', 'docs/deep/Setup-Guide.md');
    await expect(results.nth(1).locator('.workspace-search-result-path')).toHaveText('docs/deep');
    await expect(page.locator('.workspace-tree')).toHaveCount(0);
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-workspace-search.png') });

    await results.nth(1).click();
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
    await expect(page.locator('.ProseMirror').filter({ visible: true })).toContainText('Setup guide body');
    await expect(results).toHaveCount(2);

    await results.nth(0).click();
    await expect(page.locator('.workspace-search')).toHaveCount(0);
    const folderRow = page.locator('.workspace-entry[data-relative-path="docs/deep/release-guide"]');
    await expect(folderRow).toHaveClass(/selected/);
    await expect(folderRow).toHaveAttribute('aria-expanded', 'true');

    await page.locator('.workspace-search-toggle').click();
    await input.fill('nothing-matches');
    await expect(page.locator('.workspace-search-status')).toHaveText('没有找到匹配的文件或文件夹');
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await expect(page.locator('.workspace-tree')).toHaveCount(1);
    await input.press('Escape');
    await expect(page.locator('.workspace-search')).toHaveCount(0);
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
