import { expect, test } from '@playwright/test';
import { copyFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchPreviewWorkspace, previewFixtures } from './support/previewWorkspace';

const RULE = '---\ndescription: Release rule\nalwaysApply: true\n---\n\n# Release rule\n\n- **push** the tag\n';

test('mp4 plays and seeks; .mdc opens in the Markdown editor', async () => {
  const ws = await launchPreviewWorkspace({ 'rule.mdc': RULE }, 1600, (workspace) => {
    copyFileSync(path.join(previewFixtures, 'sample.mp4'), path.join(workspace, 'sample.mp4'));
  });
  const { page } = ws;
  try {
    await ws.open('sample.mp4');
    const video = page.locator('#file-preview-root video');
    await expect(video).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await video.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
    await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 1.5; });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && Math.abs(element.currentTime - 1.5) < 0.1)).toBe(true);
    await expect(page.locator('#file-preview-root [role="alert"]')).toHaveCount(0);

    await ws.open('rule.mdc');
    const editor = page.locator('.ProseMirror').filter({ visible: true });
    await expect(editor.locator('h1')).toContainText('Release rule');
    await expect(editor.locator('strong')).toHaveText('push');
    await expect(editor.locator('.frontmatter-row').filter({ hasText: 'description' })).toContainText('Release rule');
    await expect(editor.locator('.frontmatter-key').filter({ hasText: 'alwaysApply' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await readFile(path.join(ws.workspace, 'rule.mdc'), 'utf8')).toBe(RULE);
  } finally { await ws.dispose(); }
});

test('audio shows a live spectrum; video controls hide while playing once the pointer leaves', async () => {
  const ws = await launchPreviewWorkspace({}, 1600, (workspace) => {
    copyFileSync(path.join(previewFixtures, 'sample.mp4'), path.join(workspace, 'sample.mp4'));
  });
  const { page } = ws;
  try {
    // Keep the run silent: anything routed to the speakers goes through a zero-gain node first.
    await page.evaluate(() => {
      const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
      AudioNode.prototype.connect = function silenced(this: AudioNode, ...args: unknown[]) {
        if (!(args[0] instanceof AudioDestinationNode)) return connect.apply(this, args);
        const mute = this.context.createGain();
        mute.gain.value = 0;
        connect.call(this, mute);
        return connect.call(mute, args[0]);
      } as typeof AudioNode.prototype.connect;
    });
    await ws.open('样例文件/中文/示例音频.mp3');
    const viewer = page.locator('#file-preview-root .preview-audio-viewer');
    await expect(viewer.locator('.preview-audio-title')).toHaveText('示例音频.mp3', { timeout: 30_000 });
    await expect(viewer.locator('.preview-media-time')).toHaveText(/^0:00 \/ (?!0:00)\d+:\d\d$/);
    const tallestBar = () => viewer.locator('.preview-audio-spectrum').evaluate((canvas: HTMLCanvasElement) => {
      const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let rows = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 0) { rows += 1; break; }
      }
      return rows / height;
    });
    expect(await tallestBar()).toBeLessThan(0.2);
    await viewer.getByRole('button', { name: '播放' }).click();
    await expect.poll(tallestBar, { timeout: 5_000 }).toBeGreaterThan(0.3);
    await viewer.getByRole('button', { name: '暂停' }).click();
    await expect.poll(tallestBar, { timeout: 5_000 }).toBeLessThan(0.2);

    await ws.open('sample.mp4');
    const stage = page.locator('#file-preview-root .preview-video-frame');
    const controls = stage.locator('.preview-video-controls');
    await expect(controls).toBeVisible({ timeout: 30_000 });
    // A small video keeps its own size (never enlarged) and the control bar sits on the picture's bottom edge.
    await expect.poll(() => stage.evaluate((frame) => {
      const video = frame.querySelector('video')!;
      const box = frame.getBoundingClientRect();
      const bar = frame.querySelector('.preview-video-controls')!.getBoundingClientRect();
      return box.width === video.videoWidth && box.height === video.videoHeight && Math.abs(bar.bottom - box.bottom) < 1;
    })).toBe(true);
    await stage.locator('video').evaluate((video: HTMLVideoElement) => { video.muted = true; video.loop = true; });
    await stage.hover();
    await controls.getByRole('button', { name: '播放' }).click();
    await expect(stage).not.toHaveClass(/is-idle/);
    await page.mouse.move(1, 1);
    await expect(stage).toHaveClass(/is-idle/);
    await expect(controls).toHaveCSS('opacity', '0');
    await stage.hover();
    await expect(stage).not.toHaveClass(/is-idle/);
    await expect(controls).toHaveCSS('opacity', '1');
    await controls.getByRole('button', { name: '暂停' }).click();
    await page.mouse.move(1, 1);
    await expect(stage).not.toHaveClass(/is-idle/);
  } finally { await ws.dispose(); }
});
