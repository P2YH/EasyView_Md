import { expect, test } from '@playwright/test';
import { isMarkdownFilePath } from '@easyview/contracts';
import { listSampleFiles } from '../../../tests/fixtures/sampleFiles';
import { launchPreviewWorkspace, SAMPLE_WORKSPACE_FOLDER, type PreviewWorkspace } from './support/previewWorkspace';

/** Smoke test over every file in the repo's `样例文件/`: each one opens and renders without an error. */
test.describe.serial('样例文件 samples', () => {
  let ws: PreviewWorkspace;
  test.beforeAll(async () => { ws = await launchPreviewWorkspace(); });
  test.afterAll(async () => { await ws?.dispose(); });

  for (const file of listSampleFiles()) {
    test(file, async () => {
      const { page } = ws;
      const htmlPageText = () => page.evaluate(() =>
        document.querySelector<HTMLIFrameElement>('#file-preview-root iframe')?.contentDocument?.body?.innerText.trim() ?? '');
      // HTML previews reuse the same iframe, so compare the page it shows rather than counting new elements.
      const previousHtml = await htmlPageText();
      // Whatever the previous sample rendered must not count for this one.
      await page.evaluate(() => document.querySelectorAll('#file-preview-root *, .ProseMirror').forEach((node) => { (node as HTMLElement).dataset.e2eStale = '1'; }));
      await ws.open(`${SAMPLE_WORKSPACE_FOLDER}/${file}`);
      if (isMarkdownFilePath(file)) {
        await expect.poll(() => page.locator('.ProseMirror:not([data-e2e-stale])').filter({ visible: true }).innerText(), { timeout: 30_000 }).not.toBe('');
        return;
      }
      const root = page.locator('#file-preview-root');
      await expect(root).toBeVisible({ timeout: 30_000 });
      if (/\.(mp4|m4v|mp3|m4a|wav|ogg|oga|flac)$/i.test(file)) {
        const media = root.locator('video:not([data-e2e-stale]), audio:not([data-e2e-stale])');
        await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.duration).catch(() => 0), { timeout: 30_000 }).toBeGreaterThan(0);
        return;
      }
      if (/\.html?$/i.test(file)) {
        await expect.poll(async () => { const text = await htmlPageText(); return text !== '' && text !== previousHtml; }, { timeout: 30_000 }).toBe(true);
        return;
      }
      await expect.poll(() => root.evaluate((element) => {
        if (element.querySelector('.preview-viewer-error:not([data-e2e-stale]), [role="alert"]:not([data-e2e-stale])')) return 'error';
        if (/不支持|not supported/i.test((element as HTMLElement).innerText)) return 'unsupported';
        // Loading and status text use .preview-viewer-message; a rendered document paints many boxes.
        if (element.querySelector('.preview-viewer-message:not([data-e2e-stale])')) return 'pending';
        const painted = [...element.querySelectorAll('*:not([data-e2e-stale])')].filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 40 && box.height > 40;
        });
        return painted.length >= 5 ? 'rendered' : 'pending';
      }), { timeout: 45_000 }).toBe('rendered');
    });
  }
});
