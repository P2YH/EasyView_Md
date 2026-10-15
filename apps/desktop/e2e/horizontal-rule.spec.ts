import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('--- plus Enter becomes a rule in WYSIWYG and renders as a full-width line in source mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'easyview-desktop-hr-'));
  const userData = join(directory, 'user-data');
  const filePath = join(directory, 'rules.md');
  await mkdir(userData);
  await writeFile(filePath, '# 分割线\n\n上一段。\n\n---\n\n下一段。\n\n```\n---\n```\n');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [filePath],
    workspace: {
      rootPath: directory, openTabs: [{ id: 'hr-tab', kind: 'editor', filePath }], activeTabId: 'hr-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 280, outlineWidth: 280,
    },
  }));

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    const prose = page.locator('.ProseMirror');
    await expect(prose.locator('hr')).toHaveCount(1);

    const target = prose.getByText('下一段。', { exact: true });
    await target.click();
    // ProseMirror syncs a mouse-placed caret shortly after mouseup; keys sent sooner use the old selection.
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('---');
    // KeyboardOverrides drops a second Enter within 100ms as a duplicate webview event.
    await page.waitForTimeout(300);
    await expect(prose).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('回车生成。');
    await expect(prose.locator('hr')).toHaveCount(2);
    await expect(prose).toContainText('回车生成。');

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('desktop.menuCommand', 'toggleSourceMode');
    });
    const ruleLines = page.locator('.cm-line.cm-hr-line');
    await expect(ruleLines).toHaveCount(2);
    await expect(page.locator('.cm-line', { hasText: /^---$/ })).toHaveCount(3);
    const background = await ruleLines.first().evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(background).toContain('linear-gradient');
    await page.locator('.cm-line', { hasText: '上一段。' }).click();
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-source-hr.png') });
  } finally {
    await terminateElectron(application);
    await rm(directory, { recursive: true, force: true });
  }
});
