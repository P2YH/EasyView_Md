import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

test('closed outline collapses to a heading rail that expands on hover and can be pinned back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'easyview-outline-minimap-'));
  const userData = join(directory, 'user-data');
  const filePath = join(directory, 'doc.md');
  const headings = ['概述', '背景', '目标', '方案', '细节', '总结'];
  await mkdir(userData);
  await writeFile(filePath, headings.map((name, index) => `${'#'.repeat(index % 3 + 1)} ${name}\n\n${'正文段落。\n\n'.repeat(12)}`).join('\n'));
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [filePath], workspace: {
      rootPath: directory, openTabs: [{ id: 'doc-tab', kind: 'editor', filePath }], activeTabId: 'doc-tab',
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
    const page = await app.firstWindow();
    await resumeRestoredSession(page);
    await expect(page.locator('#outline-toggle')).toHaveCount(0);
    await expect(page.locator('.toc-sidebar')).toBeVisible();
    const miniMap = page.locator('.outline-minimap');
    await expect(miniMap).toBeHidden();

    await page.locator('.toc-sidebar-unpin').click();
    await expect(page.locator('.toc-sidebar')).toHaveClass(/hidden/);
    await expect(miniMap).toBeVisible();
    await expect(miniMap.locator('.outline-minimap-dash')).toHaveCount(headings.length);
    await expect(miniMap.locator('.outline-minimap-dash.active')).toHaveCount(1);

    const panel = miniMap.locator('.outline-minimap-panel');
    await expect(panel).toBeHidden();
    await miniMap.hover();
    await expect(panel).toBeVisible();
    await expect(panel.locator('.outline-minimap-item')).toHaveText(headings);
    await panel.locator('.outline-minimap-item').filter({ hasText: '总结' }).click();
    await expect(panel.locator('.outline-minimap-item.active')).toHaveText('总结');

    await panel.locator('.outline-minimap-pin').click();
    await expect(page.locator('.toc-sidebar')).not.toHaveClass(/hidden/);
    await expect(miniMap).toBeHidden();
  } finally {
    await terminateElectron(app);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(() => undefined);
  }
});
