import { _electron as electron, expect, test, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shotDir = '/Users/zhangxy/GenAI/EasyView_Md/.verify-shots';
const tmp = process.env.CURSOR_ACCENT_TMP!;

async function findFrame(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) { found = frame; return true; }
    }
    return false;
  }, { timeout: 90_000 }).toBe(true);
  return found!;
}

test('cursor installed vsix markdown accent dropdown', async () => {
  test.setTimeout(180_000);
  test.skip(!tmp, 'CURSOR_ACCENT_TMP missing');
  const application = await electron.launch({
    executablePath: '/Applications/Cursor.app/Contents/MacOS/Cursor',
    args: [
      `--user-data-dir=${join(tmp, 'data')}`,
      `--extensions-dir=${join(tmp, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      join(tmp, 'workspace'),
      join(tmp, 'workspace', 'notes.md'),
    ],
    timeout: 60_000,
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(shotDir, 'ext-cursor-01-before.png') });
    const frame = await findFrame(page, '.ProseMirror, .file-header-accent-select');
    await frame.evaluate(() => document.body.classList.remove('easyview-toolbar-collapsed'));
    const accent = frame.locator('.file-header-accent-select').first();
    await expect(accent).toBeVisible({ timeout: 30_000 });
    await accent.click();
    const menu = frame.locator('.file-header-accent-menu.open');
    await expect(menu).toBeVisible();
    expect(await menu.locator('.file-header-accent-option').count()).toBeGreaterThanOrEqual(6);
    const metrics = await frame.evaluate(() => {
      const menuEl = document.querySelector('.file-header-accent-menu.open')!;
      const barEl = document.querySelector('.file-header-bar')!;
      const bs = getComputedStyle(barEl);
      const mr = menuEl.getBoundingClientRect();
      const br = barEl.getBoundingClientRect();
      return { barOverflow: `${bs.overflow}/${bs.overflowY}`, menuHeight: mr.height, extendsBelowBar: mr.bottom > br.bottom + 2 };
    });
    console.log('CURSOR_INSTALLED_METRICS', JSON.stringify(metrics));
    await page.screenshot({ path: join(shotDir, 'ext-cursor-02-accent-open.png') });
  } finally {
    try { await application.close(); } catch {}
  }
});
