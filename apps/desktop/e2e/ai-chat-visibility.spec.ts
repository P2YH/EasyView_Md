import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const appDir = process.cwd();

test('AI chat toggle reflects the panel and its visibility survives a restart', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-ai-chat-visibility-')));
  const workspace = join(temporaryDirectory, 'chat-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  const notes = join(workspace, 'notes.md');
  const other = join(workspace, 'other.md');
  await mkdir(workspace, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(notes, '# Notes\n', 'utf8');
  await writeFile(other, '# Other\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    recentFiles: [notes],
    workspace: {
      rootPath: workspace,
      openTabs: [{ id: 'notes-tab', kind: 'editor', filePath: notes }, { id: 'other-tab', kind: 'editor', filePath: other }],
      activeTabId: 'notes-tab',
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 280,
    },
  }), 'utf8');

  const launch = async (): Promise<{ application: ElectronApplication; page: Page }> => {
    const application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
    const page = await application.firstWindow();
    await resumeRestoredSession(page);
    return { application, page };
  };
  const visiblePanels = (page: Page) => page.locator('#desktop-ai-chat-host .ai-chat-panel:not(.hidden):not(.suspended)');

  let application: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ application, page } = await launch());
    const toggle = page.locator('#ai-chat-toggle');
    await expect(toggle).not.toHaveClass(/\bactive\b/);
    await toggle.click();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(toggle).toHaveClass(/\bactive\b/);

    await page.locator('.desktop-tab', { hasText: 'other.md' }).click();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(toggle).toHaveClass(/\bactive\b/);

    const savedWorkspace = async () => JSON.parse(await readFile(join(userData, 'desktop-state.json'), 'utf8')).workspace;
    await expect.poll(async () => (await savedWorkspace()).aiChatVisible, { timeout: 10000 }).toBe(true);
    await terminateElectron(application);
    ({ application, page } = await launch());
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(page.locator('#ai-chat-toggle')).toHaveClass(/\bactive\b/);
    await page.locator('#ai-chat-toggle').click();
    await expect(visiblePanels(page)).toHaveCount(0);
    await expect(page.locator('#ai-chat-toggle')).not.toHaveClass(/\bactive\b/);
  } finally {
    if (application) await terminateElectron(application);
  }
});

test('the full welcome page hides a remembered AI chat until the user opens it there', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-ai-chat-welcome-')));
  const userData = join(temporaryDirectory, 'user-data');
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    workspace: {
      rootPath: null, openTabs: [], activeTabId: null, aiChatVisible: true,
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 280,
    },
  }), 'utf8');

  const application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
  try {
    const page = await application.firstWindow();
    const host = page.locator('#desktop-ai-chat-host');
    const toggle = page.locator('#ai-chat-toggle');
    await expect(page.locator('#desktop-welcome')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/\bdesktop-welcome-full\b/);
    await expect(host).toBeHidden();
    await expect(toggle).not.toHaveClass(/\bactive\b/);

    await toggle.click();
    await expect(host.locator('.ai-chat-panel:not(.hidden):not(.suspended)')).toBeVisible();
    await expect(toggle).toHaveClass(/\bactive\b/);
  } finally {
    await terminateElectron(application);
  }
});

test('AI chat opens without an open Markdown file and hands over to the editor panel', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-ai-chat-standalone-')));
  const workspace = join(temporaryDirectory, 'chat-workspace');
  const userData = join(temporaryDirectory, 'user-data');
  await mkdir(workspace, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(join(workspace, 'notes.md'), '# Notes\n', 'utf8');
  await writeFile(join(userData, 'desktop-state.json'), JSON.stringify({
    workspace: {
      rootPath: workspace, openTabs: [], activeTabId: null,
      expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 280,
    },
  }), 'utf8');

  const application = await electron.launch({ args: [appDir, `--user-data-dir=${userData}`] });
  try {
    const page = await application.firstWindow();
    const visiblePanels = page.locator('#desktop-ai-chat-host .ai-chat-panel:not(.hidden):not(.suspended)');
    const toggle = page.locator('#ai-chat-toggle');
    await expect(page.locator('.desktop-tab')).toHaveCount(0);
    await toggle.click();
    await expect(visiblePanels).toHaveCount(1);
    await expect(toggle).toHaveClass(/\bactive\b/);
    await expect(visiblePanels.locator('.ai-chat-input')).toBeVisible();

    await page.locator('.workspace-entry-name', { hasText: 'notes.md' }).click();
    await expect(page.locator('.desktop-tab', { hasText: 'notes.md' })).toBeVisible();
    await expect(visiblePanels).toHaveCount(1);
    await expect(toggle).toHaveClass(/\bactive\b/);

    await toggle.click();
    await expect(visiblePanels).toHaveCount(0);
    await expect(toggle).not.toHaveClass(/\bactive\b/);
  } finally {
    await terminateElectron(application);
  }
});
