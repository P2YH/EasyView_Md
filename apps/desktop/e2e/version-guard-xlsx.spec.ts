import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';
test('Version Guard shows a changed workbook as a cell-by-cell comparison', async () => {
  test.setTimeout(120000);
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'easyview-guard-xlsx-')));
  const repo = join(temp, 'workspace'), profile = join(temp, 'profile'), file = join(repo, '预算.xlsx');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const save = async (rows: unknown[][], extra?: string) => { const book = new ExcelJS.Workbook(); book.addWorksheet('预算').addRows(rows); if (extra) book.addWorksheet(extra).addRow(['新表']); await book.xlsx.writeFile(file); };
  await mkdir(repo, { recursive: true }); git('init', '-q'); git('config', 'user.name', 'Guard'); git('config', 'user.email', 'guard@example.test');
  await writeFile(join(repo, 'notes.md'), '# Notes\n');
  await save([['项目', '金额', '负责人'], ['服务器', 1200, '张三'], ['带宽', 300, '李四'], ['域名', 80, '王五']]); git('add', '.'); git('commit', '-qm', 'Initial');
  await save([['项目', '金额', '负责人'], ['服务器', 1500, '张三'], ['CDN', 260, '赵六'], ['带宽', 300, '李四']], '备注');
  await mkdir(profile); await writeFile(join(profile, 'desktop-state.json'), JSON.stringify({ recentFiles: [join(repo, 'notes.md')], workspace: { rootPath: repo, openTabs: [{ id: 'notes', kind: 'editor', filePath: join(repo, 'notes.md') }], activeTabId: 'notes', expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 240 } }));
  const app = await electron.launch({ args: [process.cwd(), `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await resumeRestoredSession(page);
    await page.getByRole('button', { name: '仓库版本管理', exact: true }).click();
    const title = page.locator('.version-guard .guard-repo-title').first();
    await expect(async () => {
      if ((await title.getAttribute('aria-expanded')) !== 'true') await title.click();
      await expect(page.locator('.version-guard .guard-file-name', { hasText: '预算.xlsx' })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 40000 });
    await page.locator('.version-guard .guard-file-name', { hasText: '预算.xlsx' }).click();
    const view = page.locator('.easyview-history-view.evsd');
    await expect(view.locator('.evsd-tab')).toHaveText(['预算3', '备注1']);
    const [base, content] = [view.locator('.evsd-pane').nth(0), view.locator('.evsd-pane').nth(1)];
    await expect(base.locator('td.is-old').first()).toHaveText('1200');
    await expect(content.locator('td.is-new').first()).toHaveText('1500');
    await expect(content.locator('tr.is-added td').first()).toHaveText('CDN');
    await expect(base.locator('tr.is-removed td').first()).toHaveText('域名');
    await page.screenshot({ path: '/tmp/easyview-version-guard-xlsx.png' });
    await view.locator('.evsd-filter input').check();
    await expect(content.locator('tr.evsd-gap')).toHaveCount(2);
    await page.screenshot({ path: '/tmp/easyview-version-guard-xlsx-filtered.png' });
    expect(errors).toEqual([]);
  } finally { await terminateElectron(app); await rm(temp, { recursive: true, force: true }); }
});
