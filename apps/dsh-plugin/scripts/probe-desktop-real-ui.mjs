/** Opt-in installed Desktop test: original EasyView input -> current GPT -> editor -> durable checkpoint. */
import { _electron, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.EASYVIEW_DESKTOP_EXE, workspace = process.env.EASYVIEW_DESKTOP_WORKSPACE;
if (!executablePath || !workspace) throw new Error('Explicit installed Desktop executable and authorized workspace are required. Quit Desktop before running.');
const folder = `easyview-gpt-ui-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const fixtureRoot = resolve(workspace, folder), original = '# UI原始标题\n\nKEEP_UI_PARAGRAPH_20261028\n';
await mkdir(fixtureRoot, { recursive: true }); await writeFile(resolve(fixtureRoot, 'ui-note.md'), original);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, page, frame;
let result = { status: 'running', kind: 'installed Desktop / original EasyView UI / real current GPT', fixtureRoot,
  realUserRequests: 0, browserErrors: [] };
const installedRoot = resolve(process.env.USERPROFILE, '.dsh/profiles/desktop/node_modules/dsh-plugin-easyview');
result.installedRuntime = Object.fromEntries(await Promise.all(['lib/index.js', 'lib/ai-preset.js', 'lib/workbench/asset-manifest.json']
  .map(async path => [path, createHash('sha256').update(await readFile(resolve(installedRoot, path))).digest('hex')])));
try {
  app = await _electron.launch({ executablePath, args: [], env, timeout: 90_000 });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    page = app.context().pages().find(candidate => candidate.url().startsWith('dsh-app://app'));
    if (page && await page.evaluate(async () => (await fetch('/api/easyview/v1/bootstrap').catch(() => null))?.ok)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(page); page.setDefaultTimeout(30_000);
  // This process owns only synthetic test documents; accept their beforeunload
  // confirmation so Electron's orderly quit is not auto-dismissed by Playwright.
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => result.browserErrors.push(error.message));
  const api = async path => page.evaluate(async path => {
    const response = await fetch(`/api/easyview/v1/${path}`); return response.json();
  }, path);
  const catalog = (await api('models')).value;
  assert.match(catalog.default.model, /gpt/i); result.model = catalog.default;
  // Navigation lives only in the Office platform, below My Agents.
  await expect(page.getByRole('button', { name: '文档工作台', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '办公智能体', exact: true }).click();
  const portal = page.frameLocator('iframe[title="办公智能体"]');
  await portal.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '文档工作台', exact: true }).click();
  console.log('Opened installed Desktop Office document workbench');
  frame = page.frameLocator('iframe[title="EasyView 文档工作台"]');
  await frame.locator('.desktop-welcome-recent-open').first().click();
  await frame.locator(`[data-relative-path="${folder}"] .workspace-entry-name`).click();
  await frame.locator(`[data-relative-path="${folder}/ui-note.md"] .workspace-entry-name`).click();
  const prose = frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror');
  await expect(prose).toContainText('UI原始标题');
  assert.equal(await frame.locator('#ai-chat-toggle').getAttribute('aria-pressed'), 'true', 'AI sidebar opens by default');
  const panel = frame.locator('.ai-chat-panel:not(.hidden):not(.suspended)');
  await panel.waitFor({ state: 'visible' });
  await panel.locator('.ai-chat-model-btn').click();
  const model = `${catalog.default.provider} / ${catalog.default.model}`;
  await panel.locator('.ai-chat-model-option').filter({ hasText: model }).click();
  if ((await panel.locator('.ai-chat-mode-label').innerText()) !== 'Agent') {
    await panel.locator('.ai-chat-mode-current').click();
    await panel.locator('[data-mode="agent"]').click();
  }
  const input = panel.locator('.ai-chat-input');
  await input.fill('请先读取当前文档，用文档修改工具仅将标题“UI原始标题”改为“GPT界面修改成功”，保持其它内容，不保存原件。完成后回复“UI_GPT_COMPLETE”。');
  result.realUserRequests++; await input.press('Enter'); console.log('Sent real GPT request through original EasyView input');
  await expect(prose).toContainText('GPT界面修改成功', { timeout: 180_000 });
  await expect(panel.locator('.ai-chat-msg.assistant')).toContainText('UI_GPT_COMPLETE', { timeout: 180_000 });
  await expect(panel.locator('.ai-chat-bubble.streaming-markdown')).toHaveCount(0, { timeout: 30_000 });
  await expect(prose).toContainText('KEEP_UI_PARAGRAPH_20261028');
  await expect(panel.locator('.ai-chat-tool-line.running')).toHaveCount(0, { timeout: 30_000 });
  await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor();
  assert.equal(await readFile(resolve(fixtureRoot, 'ui-note.md'), 'utf8'), original);
  await frame.locator('#workspace-toggle').click();
  await page.screenshot({ path: resolve(root, 'docs/evidence/e05-desktop-real-ui.png'), fullPage: true });
  await prose.click(); await page.keyboard.press('ControlOrMeta+z');
  await expect(prose).toContainText('UI原始标题');
  await expect(prose).not.toContainText('GPT界面修改成功');
  await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor();
  assert.deepEqual((await api('models')).value.default, catalog.default);
  result = { ...result, status: 'passed', originalSidebarEntry: true, originalAiInput: true, originalMarkdownEditor: true,
    realModelLocalPatch: true, durableCheckpoint: true, toolFeedback: true, batchUndo: true, originalUnchanged: true, globalModelUnchanged: true };
} catch (error) {
  result = { ...result, status: 'failed', error: error.stack };
  await page?.screenshot({ path: resolve(root, 'docs/evidence/e05-desktop-real-ui-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(resolve(root, 'docs/evidence/e05-desktop-real-ui.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await app?.close();
}
