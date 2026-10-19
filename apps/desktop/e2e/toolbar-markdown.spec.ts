import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { launchPreviewWorkspace, type PreviewWorkspace } from './support/previewWorkspace';

/** Every Markdown file-header button and the desktop title-bar buttons, each with its effect asserted. */
const header = (page: Page) => page.locator('.file-header-bar').locator('visible=true').first();
/**
 * Header button by title. When the header is narrow, buttons collapse into the "更多操作" menu;
 * the returned handle clicks them there, so the same action is exercised either way.
 */
const byTitle = (page: Page, title: string) => {
  const direct = header(page).locator(`[title^="${title}"]`).locator('visible=true').first();
  return {
    async click() {
      if (await direct.isVisible().catch(() => false)) { await direct.click(); return; }
      await header(page).locator('[title="更多操作"]').click();
      await page.locator(`[title^="${title}"], [aria-label^="${title}"]`).or(page.getByText(title.replace(/\s*\(.*$/, ''), { exact: false })).locator('visible=true').last().click();
    },
    getAttribute: (name: string) => direct.getAttribute(name),
  };
};
const prose = (page: Page) => page.locator('.desktop-editor-session:not([hidden]) .ProseMirror');
const long = `# Notes\n\nBody text.\n\n${Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nParagraph ${i}.\n`).join('\n')}\n| a | b |\n| - | - |\n| 1 | 2 |\n`;

function git(cwd: string, ...args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

async function launch(): Promise<PreviewWorkspace> {
  return launchPreviewWorkspace({ 'long.md': long }, 1600, (workspace) => {
    git(workspace, 'init', '-q'); git(workspace, 'config', 'user.name', 'e2e'); git(workspace, 'config', 'user.email', 'e2e@example.com');
    git(workspace, 'add', '-A'); git(workspace, 'commit', '-qm', 'init');
  });
}

test('markdown header: view buttons (outline, source, width, table wrap, fold, zoom, scroll, follow, sticky note)', async () => {
  const ws = await launch(); const { page } = ws;
  try {
    await page.evaluate(async () => { await (window as any).easyViewDesktop.tabs.openWorkspaceEntry('long.md'); });
    await expect(prose(page)).toContainText('Section 59');

    const toc = page.locator('.desktop-editor-session:not([hidden]) .toc-sidebar').first();
    const tocHidden = async () => ((await toc.getAttribute('class')) ?? '').includes('hidden') || !(await toc.isVisible());
    const tocBefore = await tocHidden();
    await byTitle(page, '切换目录').click(); await expect.poll(tocHidden).toBe(!tocBefore);
    // With the outline open, the header button hides and the outline's own pin button closes it.
    const toggleBack = header(page).locator('[title^="切换目录"]').locator('visible=true').first();
    if (await toggleBack.isVisible().catch(() => false)) await toggleBack.click();
    else await page.locator('.desktop-editor-session:not([hidden]) .toc-sidebar-unpin, .toc-sidebar-unpin').locator('visible=true').first().click();
    await expect.poll(tocHidden).toBe(tocBefore);

    await byTitle(page, '切换源码模式').click();
    await expect(page.locator('.desktop-editor-session:not([hidden])').getByText('## Section 1', { exact: false }).first()).toBeVisible();
    await byTitle(page, '切换源码模式').click();
    await expect(prose(page)).toBeVisible();

    const width = () => prose(page).locator('p').first().evaluate((element) => Math.round(element.getBoundingClientRect().width));
    const w0 = await width();
    await header(page).locator('[title*="全宽"]').first().click(); await expect.poll(width).not.toBe(w0);
    await header(page).locator('[title*="全宽"]').first().click(); await expect.poll(width).toBe(w0);

    const wrap = header(page).locator('[title*="表格自动换行"]').first();
    const wrapTitle = await wrap.getAttribute('title');
    await wrap.click(); await expect(wrap).not.toHaveAttribute('title', wrapTitle!);
    await wrap.click(); await expect(wrap).toHaveAttribute('title', wrapTitle!);

    const paragraph = prose(page).getByText('Paragraph 3.', { exact: true });
    await expect(paragraph).toBeVisible();
    await header(page).locator('[title*="所有标题"]').first().click(); await expect(paragraph).toBeHidden();
    await header(page).locator('[title*="所有标题"]').first().click(); await expect(paragraph).toBeVisible();

    const size = () => prose(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const s0 = await size();
    await header(page).locator('[title^="放大"]').first().click(); await expect.poll(size).toBeGreaterThan(s0);
    await header(page).locator('[title^="缩小"]').first().click(); await expect.poll(size).toBe(s0);
    await header(page).locator('[title^="缩小"]').first().click(); await expect.poll(size).toBeLessThan(s0);
    await header(page).locator('[title^="放大"]').first().click(); await expect.poll(size).toBe(s0);

    const scroller = () => page.evaluate(() => { let e = document.querySelector('.desktop-editor-session:not([hidden]) .ProseMirror') as HTMLElement | null; while (e && !(e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e ? e.scrollTop : -1; });
    await byTitle(page, '滚动到底部').click(); await expect.poll(scroller).toBeGreaterThan(200);
    await byTitle(page, '滚动到顶部').click(); await expect.poll(scroller).toBeLessThan(5);

    const follow = header(page).locator('[title*="自动跟随滚动"]').first();
    const followTitle = await follow.getAttribute('title');
    await follow.click(); await expect(follow).not.toHaveAttribute('title', followTitle!);
    await follow.click(); await expect(follow).toHaveAttribute('title', followTitle!);

    const notes = () => page.locator('.easyview-sticky-note').locator('visible=true').count();
    const n0 = await notes();
    await byTitle(page, '切换小签编辑器').click(); await expect.poll(notes).not.toBe(n0);
    await byTitle(page, '切换小签编辑器').click(); await expect.poll(notes).toBe(n0);
  } finally { await ws.dispose(); }
});

test('markdown header: git (changes, stage, commit), terminal, history, export, theme, accent, shortcuts', async () => {
  test.setTimeout(150_000);
  const ws = await launch(); const { page, application } = ws;
  try {
    await expect(prose(page)).toContainText('Body text.');
    await prose(page).locator('p').last().click(); await page.keyboard.press('End'); await page.keyboard.type(' Changed.');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => git(ws.workspace, 'status', '--porcelain')).toContain('notes.md');

    await expect(header(page).locator('[title^="查看变更"]').first()).not.toHaveAttribute('title', /没有未提交/);
    await header(page).locator('[title^="查看变更"]').first().click();
    await expect(page.locator('[class*="diff" i], [class*="change" i]').filter({ hasText: 'Changed.' }).first()).toBeVisible();
    await header(page).locator('[title*="变更"]').first().click();

    await byTitle(page, '暂存当前文件').click();
    await expect.poll(() => git(ws.workspace, 'diff', '--cached', '--name-only')).toContain('notes.md');
    await byTitle(page, '提交当前文件').click();
    const message = page.locator('textarea, input[type="text"]').locator('visible=true').last();
    await message.fill('e2e commit');
    await page.getByRole('button', { name: /^提交/ }).locator('visible=true').last().click();
    await expect.poll(() => git(ws.workspace, 'log', '-1', '--pretty=%s')).toContain('e2e commit');
    const backdrop = page.locator('.file-header-commit-backdrop.open');
    if (await backdrop.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); if (await backdrop.isVisible().catch(() => false)) await backdrop.click({ position: { x: 5, y: 5 } }); }
    await expect(backdrop).toBeHidden();

    await byTitle(page, '打开内置终端').click();
    const termModal = page.locator('.easyview-terminal-modal.visible');
    await expect(termModal).toBeVisible();
    await byTitle(page, '打开内置终端').click().catch(() => undefined);
    if (await termModal.isVisible()) await page.keyboard.press('Escape');
    if (await termModal.isVisible()) await page.locator('.easyview-terminal-modal [class*="close" i]').first().click();
    await expect(termModal).toBeHidden();
    // History panel: opened by the header button, closed by the button again or the panel's close.
    const hb = header(page).locator('[title^="切换历史面板"]').first();
    const histOpen = () => page.evaluate(() => [...document.querySelectorAll('.history-panel')].some((e) => !e.classList.contains('hidden')));
    await expect.poll(histOpen).toBe(false);
    await hb.click(); await expect(hb).toHaveClass(/active/); await expect.poll(histOpen).toBe(true);
    await hb.click(); await expect(hb).not.toHaveClass(/active/); await expect.poll(histOpen).toBe(false);

    const out = path.join(ws.downloads, 'notes-export.html');
    await application.evaluate(({ dialog }, out) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog; }, out);
    await byTitle(page, '导出').click();
    await page.getByText(/HTML/).locator('visible=true').first().click();
    await expect.poll(async () => (await readdir(ws.downloads)).includes('notes-export.html'), { timeout: 30_000 }).toBe(true);

    const mode = () => page.evaluate(() => ['mdpre-light', 'mdpre-gray', 'mdpre-dark'].find((c) => document.body.classList.contains(c)) ?? 'none');
    const themeBtn = page.locator('[title*="（点击切换）"]').locator('visible=true').first();
    const m0 = await mode();
    await themeBtn.click(); await expect.poll(mode).not.toBe(m0);
    for (let i = 0; i < 3 && (await mode()) !== m0; i += 1) await themeBtn.click();
    await expect.poll(mode).toBe(m0);
    const accentNow = () => page.evaluate(() => document.body.dataset.mdpreAccent ?? 'default');
    const a0 = await accentNow();
    const accent = page.locator('.file-header-accent-select').locator('visible=true').first();
    await accent.click();
    await page.locator(`.file-header-accent-menu.open .file-header-accent-option:not([data-value="${a0}"])`).first().click();
    await expect.poll(accentNow).not.toBe(a0);
    await accent.click();
    await page.locator(`.file-header-accent-menu.open .file-header-accent-option[data-value="${a0}"]`).click();
    await expect.poll(accentNow).toBe(a0);

    await byTitle(page, '配置工具栏快捷键').click();
    const dialog = page.locator('.file-header-shortcuts-modal').locator('visible=true').first();
    await expect(dialog).toBeVisible(); await dialog.locator('[data-action="close"]').click(); await expect(dialog).toBeHidden();
  } finally { await ws.dispose(); }
});

test('title bar: hide toolbar, IndexArea, repository and AI chat buttons', async () => {
  const ws = await launch(); const { page } = ws;
  try {
    await expect(prose(page)).toBeVisible();
    await page.locator('.desktop-document-toolbar-toggle').click(); await expect(page.locator('body')).toHaveClass(/desktop-toolbar-hidden/);
    await page.locator('.desktop-document-toolbar-toggle').click(); await expect(page.locator('body')).not.toHaveClass(/desktop-toolbar-hidden/);
    const titleButton = (name: string) => page.locator(`.desktop-title-button[title="${name}"], .desktop-title-button[aria-label="${name}"]`).first();
    const left = () => prose(page).evaluate((element) => Math.round(element.getBoundingClientRect().left));
    const l0 = await left();
    await titleButton('IndexArea').click(); await expect(titleButton('IndexArea')).not.toHaveClass(/active/); await expect.poll(left).not.toBe(l0);
    await titleButton('IndexArea').click(); await expect(titleButton('IndexArea')).toHaveClass(/active/); await expect.poll(left).toBe(l0);
    await titleButton('仓库版本管理').click();
    await expect(titleButton('仓库版本管理')).toHaveClass(/active/);
    await titleButton('仓库版本管理').click();
    await expect(titleButton('仓库版本管理')).not.toHaveClass(/active/);
    const width = () => prose(page).evaluate((element) => Math.round(element.getBoundingClientRect().right));
    const r0 = await width(); const aiActive = /active/.test((await titleButton('AI 对话').getAttribute('class')) ?? '');
    await titleButton('AI 对话').click();
    await expect(titleButton('AI 对话')).toHaveClass(aiActive ? /^(?!.*active)/ : /active/); await expect.poll(width).not.toBe(r0);
    await titleButton('AI 对话').click(); await expect.poll(async () => Math.abs((await width()) - r0)).toBeLessThanOrEqual(2);
  } finally { await ws.dispose(); }
});
