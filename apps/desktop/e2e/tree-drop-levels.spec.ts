import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

/** Drag `source` onto the top edge of `target`, with the pointer `offsetX` px from the row's left edge. */
async function dragToTopEdge(page: Page, source: string, target: string, offsetX: number, drop: boolean): Promise<void> {
  await page.evaluate(({ source, target, offsetX, drop }) => {
    const row = (path: string) => document.querySelector<HTMLElement>(`.workspace-entry[data-relative-path="${path}"]`)!;
    const dataTransfer = new DataTransfer();
    const from = row(source);
    const to = row(target);
    const rect = to.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + offsetX, clientY: rect.top + 2 };
    from.dispatchEvent(new DragEvent('dragstart', init));
    to.dispatchEvent(new DragEvent('dragover', init));
    if (!drop) return;
    to.dispatchEvent(new DragEvent('drop', init));
    from.dispatchEvent(new DragEvent('dragend', init));
  }, { source, target, offsetX, drop });
}

async function treeOrder(page: Page): Promise<string[]> {
  const paths = await page.locator('.workspace-tree .workspace-entry').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.relativePath!));
  return paths.filter((path) => !path.startsWith('.easyview'));
}

test('dropping below a nested folder\'s last child uses the pointer X to choose the level', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-drop-levels-')));
  const workspace = join(temporaryDirectory, 'levels');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  for (const folder of ['功能设计/a-平台UI', '功能设计/b-接口管理模块', '功能设计/c-仪表盘功能', '项目管理']) {
    await mkdir(join(workspace, folder), { recursive: true });
  }
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: ['功能设计'], explorerVisible: true, outlineVisible: false, explorerWidth: 280, outlineWidth: 280,
    },
  }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    await expect.poll(() => treeOrder(page)).toEqual([
      '功能设计', '功能设计/a-平台UI', '功能设计/b-接口管理模块', '功能设计/c-仪表盘功能', '项目管理', 'notes.md',
    ]);

    // Pointer over the label: the line starts at the nested level and the folder stays inside 功能设计, at the end.
    // A tree refresh (e.g. a late file-watcher event, common on Windows) rebuilds the tree and drops the
    // indicator. A real drag repeats dragover continuously; the synthetic one fires once, so repeat it.
    const indicator = page.locator('.workspace-drop-indicator.is-visible');
    // The measurement is asserted inside toPass: on Windows a refresh between dragover and the read can
    // leave a freshly built indicator at offset 0 for a frame, so a single sample is not reliable.
    const expectLineOffset = async (source: string, offsetX: number, expected: number) => {
      await expect(async () => {
        await dragToTopEdge(page, source, '项目管理', offsetX, false);
        const rowLeft = await page.locator('.workspace-entry[data-relative-path="项目管理"]').evaluate((row) => row.getBoundingClientRect().left, undefined, { timeout: 1000 });
        const offset = Math.round(await indicator.evaluate((line) => line.getBoundingClientRect().left, undefined, { timeout: 1000 }) - rowLeft);
        expect(offset).toBe(expected);
      }).toPass({ timeout: 20000 });
    };
    await expectLineOffset('功能设计/b-接口管理模块', 120, 40);
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-tree-drop-nested.png') });

    await dragToTopEdge(page, '功能设计/b-接口管理模块', '项目管理', 120, true);
    await expect.poll(() => treeOrder(page)).toEqual([
      '功能设计', '功能设计/a-平台UI', '功能设计/c-仪表盘功能', '功能设计/b-接口管理模块', '项目管理', 'notes.md',
    ]);

    // Pointer at the far left: the line starts at the root level and the folder moves out before 项目管理.
    await expectLineOffset('功能设计/c-仪表盘功能', 4, 24);
    await dragToTopEdge(page, '功能设计/c-仪表盘功能', '项目管理', 4, true);
    await expect.poll(() => treeOrder(page)).toEqual([
      '功能设计', '功能设计/a-平台UI', '功能设计/b-接口管理模块', 'c-仪表盘功能', '项目管理', 'notes.md',
    ]);
    expect((await readdir(workspace)).sort()).toContain('c-仪表盘功能');
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
