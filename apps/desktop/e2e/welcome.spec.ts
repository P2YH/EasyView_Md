import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('welcome page covers restored tabs at launch until the user resumes or opens a file', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-welcome-resume-')));
  const workspace = join(temporaryDirectory, 'restored-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  await mkdir(workspace, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n\nRestored.\n', 'utf8');
  await writeFile(join(workspace, 'other.md'), '# Other\n\nOther file.\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: true, explorerWidth: 280, outlineWidth: 280,
    },
  }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    let page = await application.firstWindow();
    const resume = page.locator('#desktop-welcome [data-action="resume"]');
    await expect(resume).toBeVisible();
    await expect(resume).toContainText('restored-workspace · 1 个标签页 · notes.md');
    await expect(page.locator('#desktop-split-root')).toBeHidden();
    await expect(page.locator('#desktop-welcome .desktop-welcome-recent-item')).toContainText('restored-workspace');
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-welcome-resume.png') });

    await page.keyboard.press('Escape');
    await expect(page.locator('#desktop-welcome')).toBeHidden();
    await expect(page.locator('.ProseMirror')).toContainText('Restored.');
    await page.keyboard.press('Escape');
    await expect(page.locator('#desktop-welcome')).toBeHidden();

    const titles = async () => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()).sort());
    await expect.poll(titles).toEqual(['notes.md — restored-workspace']);
    const newWindow = application.waitForEvent('window');
    await page.evaluate(() => (window as unknown as { easyViewDesktop: { app: { newWindow(): Promise<unknown> } } }).easyViewDesktop.app.newWindow());
    const second = await newWindow;
    await expect(second.locator('#desktop-welcome [data-action="open-folder"]')).toBeVisible();
    await expect(second.locator('#desktop-welcome [data-action="resume"]')).toHaveCount(0);
    await expect(second.locator('#desktop-welcome .desktop-welcome-recent-item')).toContainText('restored-workspace');
    await expect.poll(titles).toEqual(['notes.md — restored-workspace', '欢迎 — EasyView_Md']);

    await terminateElectron(application);
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    page = await application.firstWindow();
    await expect(page.locator('#desktop-welcome [data-action="resume"]')).toBeVisible();
    await expect(page.locator('#workspace-explorer')).toBeHidden();
    await expect(page.locator('#desktop-document-name')).toHaveText('EasyView_Md');
    await expect(page.locator('#desktop-welcome .desktop-welcome-badge', { hasText: '当前' })).toHaveCount(0);
    await page.locator('#desktop-welcome [data-action="resume"]').click();
    await expect(page.locator('#desktop-welcome')).toBeHidden();
    await expect(page.locator('#workspace-explorer')).toBeVisible();
    await expect(page.locator('#desktop-document-name')).toHaveText('notes.md');
    await page.locator('.workspace-entry-name', { hasText: 'other.md' }).click();
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('welcome page opens a recent folder and hides once a file tab is open', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-welcome-')));
  const workspace = join(temporaryDirectory, 'notes-workspace');
  const missing = join(temporaryDirectory, 'deleted-project');
  const userData = join(temporaryDirectory, 'user-data');
  await mkdir(workspace, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(join(workspace, 'readme.md'), '# Readme\n\nHello.\n', 'utf8');
  await writeFile(join(userData, 'recent-folders.json'), JSON.stringify([workspace, missing]), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    const welcome = page.locator('#desktop-welcome');
    await expect(welcome).toBeVisible();
    await expect(page.locator('#desktop-split-root')).toBeHidden();
    await expect(welcome.locator('[data-action="open-folder"]')).toBeVisible();

    const items = welcome.locator('.desktop-welcome-recent-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('notes-workspace');
    await expect(items.nth(1)).toHaveClass(/is-missing/);
    await expect(items.nth(1).locator('.desktop-welcome-recent-open')).toBeDisabled();
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-welcome.png') });

    await items.nth(0).locator('.desktop-welcome-recent-open').click();
    await expect(page.locator('.workspace-header')).toContainText('notes-workspace');
    await expect(page.locator('.workspace-entry')).toHaveCount(1);
    await expect(welcome).toHaveAttribute('data-mode', 'empty');
    await expect(welcome.locator('.desktop-welcome-hint-text')).toHaveText('从左侧目录树选择一个文件开始');
    await expect(welcome.locator('[data-action="open-folder"]')).toHaveCount(0);
    await page.screenshot({ path: join(appDir, '../../test-results/desktop-welcome-empty.png') });

    await welcome.locator('[data-action="show-welcome"]').click();
    await expect(welcome).toHaveAttribute('data-mode', 'welcome');
    await expect(items.nth(0).locator('.desktop-welcome-badge')).toHaveText('当前');

    await items.nth(1).hover();
    await items.nth(1).locator('.desktop-welcome-recent-remove').click();
    await expect(items).toHaveCount(1);
    expect(JSON.parse(await readFile(join(userData, 'recent-folders.json'), 'utf8'))).toEqual([workspace]);
    await page.keyboard.press('Escape');
    await expect(welcome).toHaveAttribute('data-mode', 'empty');

    await page.locator('.workspace-entry-name').first().click();
    await expect(page.locator('.desktop-tab')).toHaveCount(1);
    await expect(welcome).toBeHidden();
    await expect(page.locator('#desktop-split-root')).toBeVisible();
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('launching with a document argument opens it directly instead of the welcome page', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-welcome-argv-')));
  const userData = join(temporaryDirectory, 'user-data');
  const document = join(temporaryDirectory, 'opened.md');
  await mkdir(userData, { recursive: true });
  await writeFile(document, '# Opened From Launch\n\nBody.\n', 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`, document] });
    const page = await application.firstWindow();
    await expect(page.locator('.ProseMirror')).toContainText('Opened From Launch');
    await expect(page.locator('#desktop-welcome')).toBeHidden();
    await page.locator('.ProseMirror p').last().click();
  } finally {
    await terminateElectron(application);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
