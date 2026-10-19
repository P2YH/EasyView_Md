import { expect, test } from '@playwright/test';
import path from 'node:path';
import { launchPreviewWorkspace } from './support/previewWorkspace';

/** After-screenshots of the xlsx and DOCX toolbars. Only runs with EASYVIEW_SCREENSHOT_DIR set. */
const dir = process.env.EASYVIEW_SCREENSHOT_DIR;

test('desktop toolbar screenshots', async () => {
  test.skip(!dir, 'set EASYVIEW_SCREENSHOT_DIR to capture screenshots');
  test.setTimeout(120_000);
  const ws = await launchPreviewWorkspace();
  const { page } = ws;
  const shot = (name: string) => page.screenshot({ path: path.join(dir!, name) });
  try {
    await ws.open('sample.xlsx');
    const overlay = page.locator('.x-spreadsheet-overlayer'); await expect(overlay).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const button = (icon: string) => page.locator(`.x-spreadsheet-toolbar-btns > .x-spreadsheet-toolbar-btn:has(.x-spreadsheet-icon-img.${icon})`).first();
    await shot('desktop-xlsx-toolbar.png');
    await button('align-left').click(); await page.waitForTimeout(200); await shot('desktop-xlsx-dropdown.png');
    await page.keyboard.press('Escape'); await overlay.click({ position: { x: 300, y: 300 } });
    await button('bgcolor').click(); await page.waitForTimeout(200); await shot('desktop-xlsx-color-palette.png');
    await page.keyboard.press('Escape'); await overlay.click({ position: { x: 300, y: 300 } });
    await page.locator('.preview-spreadsheet-tabs').screenshot({ path: path.join(dir!, 'desktop-xlsx-sheet-bar.png') });
    await ws.open('sample.docx');
    await expect(page.locator('.paged-editor__pages .layout-paragraph').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await shot('desktop-docx-toolbar.png');
  } finally { await ws.dispose(); }
});
