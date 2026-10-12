import { _electron as electron, expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstWindowWithDiagnostics } from './support/diagnostics';

test('H1-H5 reset the outline to the selected level, including repeated clicks after manual expansion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'easyview-toc-levels-'));
  const userData = join(directory, 'user-data');
  const filePath = join(directory, 'headings.md');
  const headings = ['章一', '节一', '项一', '内容一', '细节一', '章二', '节二', '项二', '内容二', '细节二'];
  await mkdir(userData);
  await writeFile(filePath, headings.map((name, index) => `${'#'.repeat(index % 5 + 1)} ${name}\n\n正文\n`).join('\n'));
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [filePath], workspace: {
      rootPath: directory, openTabs: [{ id: 'toc-tab', kind: 'editor', filePath }], activeTabId: 'toc-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: true, explorerWidth: 280, outlineWidth: 280,
    },
  }));
  const executablePath = process.env.EASYVIEW_DESKTOP_TEST_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [process.cwd()]), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  try {
    const page = await firstWindowWithDiagnostics(app, 'toc');
    await expect(page.locator('.toc-sidebar')).toBeVisible();
    const labels = page.locator('.toc-item-text');
    const level = (value: number) => page.locator('.toc-level-btn').filter({ hasText: new RegExp(`^H${value}$`) });
    await level(1).click();
    await expect(labels).toHaveText(['章一', '章二']);
    await page.locator('.toc-item').filter({ hasText: '章一' }).locator('.toc-item-toggle').click();
    await expect(labels).toHaveText(['章一', '节一', '章二']);
    await page.locator('.toc-item').filter({ hasText: '节一' }).locator('.toc-item-toggle').click();
    await expect(labels).toHaveText(['章一', '节一', '项一', '章二']);
    await level(1).click();
    await expect(labels).toHaveText(['章一', '章二']);
    for (const value of [2, 3, 4, 5, 1, 1]) {
      await level(value).click();
      await expect(labels).toHaveText(headings.filter((_, index) => index % 5 + 1 <= value));
      await expect(level(value)).toHaveClass(/active/);
    }
  } finally {
    const process = app.process();
    if (process.exitCode === null) {
      const exited = once(process, 'exit');
      process.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
