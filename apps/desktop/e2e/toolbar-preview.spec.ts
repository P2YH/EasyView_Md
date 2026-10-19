import { expect, test, type Page } from '@playwright/test';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { contentSize, launchPreviewWorkspace, paintedBackground, printCount, type PreviewWorkspace } from './support/previewWorkspace';

/** One test per file type: every button in its top toolbar is clicked and its effect asserted. */
type ButtonName = 'sidebar' | 'search' | 'zoomOut' | 'zoomIn' | 'zoomReset' | 'download' | 'print' | 'html' | 'theme' | 'slideshow' | 'htmlPreview' | 'htmlSource';
const toolbar: Record<string, ButtonName[]> = {
  'sample.csv': ['search', 'zoomIn', 'zoomOut', 'download', 'theme'],
  'sample.doc': ['sidebar', 'search', 'zoomIn', 'zoomOut', 'download', 'print', 'html', 'theme'],
  'sample.pdf': ['sidebar', 'search', 'zoomIn', 'zoomOut', 'zoomReset', 'download', 'print', 'html', 'theme'],
  'sample.png': ['zoomIn', 'zoomOut', 'download', 'print', 'html', 'theme'],
  'sample.pptx': ['sidebar', 'search', 'zoomIn', 'zoomOut', 'download', 'print', 'html', 'theme', 'slideshow'],
  'sample.html': ['htmlSource', 'htmlPreview', 'theme'],
  'sample.json': ['theme'],
  'sample.svg': ['theme'],
  'sample.zip': ['theme'],
  'notes.txt': ['theme'],
};
const labels: Partial<Record<ButtonName, string>> = {
  sidebar: '显示/隐藏侧边栏', search: '搜索', zoomOut: '缩小预览', zoomIn: '放大预览', zoomReset: '还原比例',
  download: '下载', print: '打印完整渲染内容', html: 'HTML', htmlPreview: '预览', htmlSource: '源码',
};
const root = (page: Page) => page.locator('#file-preview-root');
const button = (page: Page, name: ButtonName) => name === 'theme'
  ? root(page).locator('button[title*="主题（点击切换本文件）"]').first()
  : name === 'slideshow' ? root(page).locator('.pptx-slideshow-button').first()
  : root(page).getByRole('button', { name: labels[name]!, exact: true }).first();

async function downloaded(dir: string, before: string[]) {
  await expect.poll(async () => (await readdir(dir)).filter((name) => !before.includes(name) && !name.endsWith('.crdownload')).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const added = (await readdir(dir)).filter((name) => !before.includes(name));
  expect((await stat(path.join(dir, added[0]))).size).toBeGreaterThan(0);
  return added[0];
}

async function exercise(ws: PreviewWorkspace, file: string, name: ButtonName) {
  const { page } = ws; const target = button(page, name);
  await expect(target, `${file}: ${name} button`).toBeVisible();
  switch (name) {
    case 'sidebar': {
      const shell = page.locator('#file-preview-root [data-preview-sidebar]').first();
      const before = await shell.getAttribute('data-preview-sidebar');
      await target.click();
      await expect(shell).toHaveAttribute('data-preview-sidebar', before === 'hidden' ? 'visible' : 'hidden');
      await target.click();
      await expect(shell).toHaveAttribute('data-preview-sidebar', before ?? 'visible');
      return;
    }
    case 'search': {
      await target.click();
      const input = root(page).locator('input[type="search"], input[placeholder*="搜索"], .preview-search input').first();
      await expect(input).toBeVisible(); await page.keyboard.press('Escape');
      return;
    }
    case 'zoomIn': case 'zoomOut': case 'zoomReset': {
      if (name === 'zoomReset') await button(page, 'zoomIn').click();
      await expect.poll(() => contentSize(page)).toBeGreaterThan(0);
      const before = await contentSize(page);
      await target.click();
      if (name === 'zoomOut') await expect.poll(() => contentSize(page)).toBeLessThan(before);
      else if (name === 'zoomIn') await expect.poll(() => contentSize(page)).toBeGreaterThan(before);
      else await expect.poll(() => contentSize(page)).toBeLessThan(before);
      return;
    }
    case 'download': case 'html': {
      const before = await readdir(ws.downloads);
      await target.click();
      const saved = await downloaded(ws.downloads, before);
      if (name === 'html') expect(saved).toMatch(/\.html?$/i);
      return;
    }
    case 'print': {
      const before = await printCount(ws.application);
      // Print opens a menu: direct print renders a snapshot into a print window and calls print();
      // mask/stamp print opens the designer first.
      await target.click();
      await page.getByText('直接打印', { exact: true }).click();
      await expect.poll(() => printCount(ws.application), { timeout: 20_000 }).toBeGreaterThan(before);
      await target.click();
      await page.getByText('遮罩/盖章打印', { exact: true }).click();
      const designer = page.locator('.fv-print-mask-toolbar').first();
      await expect(designer).toBeVisible({ timeout: 20_000 });
      await designer.getByRole('button').filter({ hasText: /取消|Cancel/ }).first().click();
      await expect(designer).toBeHidden();
      return;
    }
    case 'theme': {
      // Per-file theme cycles light -> gray -> dark -> light; each step repaints the preview.
      const seen: string[] = []; const titles: string[] = [];
      for (let step = 0; step < 3; step += 1) {
        const before = await paintedBackground(page); titles.push((await button(page, 'theme').getAttribute('title'))!);
        await button(page, 'theme').click();
        await expect.poll(() => paintedBackground(page)).not.toBe(before);
        seen.push(await paintedBackground(page));
      }
      expect(new Set(titles).size).toBe(3);
      await expect(button(page, 'theme')).toHaveAttribute('title', titles[0]);
      return;
    }
    case 'slideshow': {
      await target.click();
      await expect(page.locator('.pptx-slideshow, [class*="slideshow-overlay"], [class*="slideshow"]:not(.pptx-slideshow-button)').first()).toBeVisible();
      await page.keyboard.press('Escape');
      return;
    }
    case 'htmlSource': {
      await target.click();
      await expect(root(page).locator('pre, code, .cm-editor, textarea').first()).toBeVisible();
      return;
    }
    case 'htmlPreview': {
      await target.click();
      await expect(root(page).locator('iframe').first()).toBeVisible();
      return;
    }
  }
}

for (const [file, buttons] of Object.entries(toolbar)) {
  test(`${file} toolbar: ${buttons.join(', ')}`, async () => {
    const ws = await launchPreviewWorkspace({ 'notes.txt': 'plain text\n' });
    try {
      await ws.open(file);
      await expect(root(ws.page)).toBeVisible();
      await expect(button(ws.page, buttons[0])).toBeVisible({ timeout: 30_000 });
      for (const name of buttons) await test.step(name, () => exercise(ws, file, name));
    } finally { await ws.dispose(); }
  });
}
