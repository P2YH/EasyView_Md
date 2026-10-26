import { _electron as electron, expect, test, type Frame, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepElectronInBackground, terminateElectron } from '../../desktop/e2e/support/electronApp';

const shotDir = '/Users/zhangxy/GenAI/EasyView_Md/.verify-shots';
const extensionRoot = '/Users/zhangxy/GenAI/EasyView_Md/apps/vscode-extension';

function resolveExecutable(): string {
  if (process.env.VSCODE_EXECUTABLE_PATH && existsSync(process.env.VSCODE_EXECUTABLE_PATH)) {
    return process.env.VSCODE_EXECUTABLE_PATH;
  }
  const candidates = [
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No VS Code / Cursor executable found');
  return found;
}

async function findFrame(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) {
        found = frame;
        return true;
      }
    }
    return false;
  }, { timeout: 90_000 }).toBe(true).catch(async (error) => {
    await page.screenshot({ path: join(shotDir, 'ext-00-no-frame.png') }).catch(() => undefined);
    const urls = page.frames().map((f) => f.url());
    console.log('FRAME_URLS', JSON.stringify(urls.slice(0, 30)));
    throw error;
  });
  return found!;
}

test('extension markdown accent dropdown is visible', async () => {
  test.setTimeout(180_000);
  const executablePath = resolveExecutable();
  console.log('EXT_ACCENT_EXECUTABLE', executablePath);
  const temporary = await mkdtemp(join(tmpdir(), 'easyview-ext-accent-'));
  const workspace = join(temporary, 'workspace');
  await mkdir(workspace);
  await mkdir(join(temporary, 'data', 'User'), { recursive: true });
  await writeFile(join(temporary, 'data', 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'window.dialogStyle': 'custom',
    'workbench.editorAssociations': { '*.md': 'easyviewMd.markdownEditor' },
  }));
  const md = join(workspace, 'notes.md');
  await writeFile(md, '# Notes\n\nBody text for extension accent dropdown verify.\n\n## Section\n\nMore.\n');

  let application;
  try {
    application = await electron.launch({
      executablePath,
      args: [
        `--user-data-dir=${join(temporary, 'data')}`,
        `--extensions-dir=${join(temporary, 'extensions')}`,
        `--extensionDevelopmentPath=${extensionRoot}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        workspace,
        md,
      ],
      timeout: 60_000,
      env: { ...process.env, EASYVIEW_DISABLE_UPDATE_CHECK: '1' },
    });
    await keepElectronInBackground(application);
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
    });
    await page.screenshot({ path: join(shotDir, 'ext-01-before.png') });

    const frame = await findFrame(page, '.ProseMirror');
    await frame.evaluate(() => document.body.classList.remove('easyview-toolbar-collapsed'));
    const showBtn = frame.locator('.file-header-show-toolbar');
    if (await showBtn.isVisible().catch(() => false)) await showBtn.click().catch(() => {});
    await page.waitForTimeout(500);

    let accent = frame.locator('.file-header-accent-select').first();
    if (!(await accent.isVisible().catch(() => false))) {
      const more = frame.locator('[title="更多操作"], [title*="More"]').first();
      if (await more.count()) await more.click();
      accent = frame.locator('.file-header-accent-select').first();
    }
    await expect(accent).toBeVisible({ timeout: 30_000 });
    await accent.click();
    await page.waitForTimeout(400);

    const menu = frame.locator('.file-header-accent-menu.open');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    const optionCount = await menu.locator('.file-header-accent-option').count();
    expect(optionCount).toBeGreaterThanOrEqual(6);

    const metrics = await frame.evaluate(() => {
      const menuEl = document.querySelector('.file-header-accent-menu.open')!;
      const barEl = document.querySelector('.file-header-bar')!;
      const bs = getComputedStyle(barEl);
      const mr = menuEl.getBoundingClientRect();
      const br = barEl.getBoundingClientRect();
      return {
        barOverflow: `${bs.overflow}/${bs.overflowY}`,
        menuHeight: mr.height,
        extendsBelowBar: mr.bottom > br.bottom + 2,
        optionTexts: [...menuEl.querySelectorAll('.file-header-accent-option')].map((el) => el.textContent),
      };
    });
    console.log('EXT_ACCENT_METRICS', JSON.stringify(metrics));
    expect(metrics.menuHeight).toBeGreaterThan(100);
    expect(metrics.extendsBelowBar).toBe(true);

    await page.screenshot({ path: join(shotDir, 'ext-02-accent-open.png') });
    const box = await menu.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(shotDir, 'ext-03-accent-clip.png'),
        clip: {
          x: Math.max(0, box.x - 30),
          y: Math.max(0, box.y - 50),
          width: Math.min(520, box.width + 80),
          height: Math.min(380, box.height + 100),
        },
      });
    }
  } finally {
    if (application) {
      try { await terminateElectron(application); }
      catch { try { await application.close(); } catch {} }
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
