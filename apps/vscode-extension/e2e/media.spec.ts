import { _electron as electron, expect, test, type Frame, type Page } from '@playwright/test';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keepElectronInBackground, terminateElectron } from '../../desktop/e2e/support/electronApp';
import { SAMPLE_FILES_DIR } from '../../../tests/fixtures/sampleFiles';

/** Real VS Code + development extension: mp4 / mp3 playback and `.mdc` rules in the Markdown editor. */
const RULE = '---\ndescription: Release rule\nalwaysApply: true\n---\n\n# Release rule\n\n- **push** the tag\n';

async function findFrame(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.locator(selector).count().catch(() => 0)) { found = frame; return true; }
    return false;
  }, { timeout: 90_000 }).toBe(true);
  return found!;
}

async function launch(file: string) {
  const executablePath = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('Set VSCODE_EXECUTABLE_PATH to the VS Code executable before running this test');
  const temporary = await mkdtemp(join(tmpdir(), 'easyview-media-vscode-')), workspace = join(temporary, 'workspace');
  await mkdir(workspace); await mkdir(join(temporary, 'data', 'User'), { recursive: true });
  await writeFile(join(temporary, 'data', 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'workbench.editorAssociations': { '*.mp4': 'easyviewMd.filePreview', '*.mp3': 'easyviewMd.filePreview', '*.mdc': 'easyviewMd.markdownEditor' } }));
  await copyFile(resolve(__dirname, '../../../tests/fixtures/preview/sample.mp4'), join(workspace, 'sample.mp4'));
  await copyFile(join(SAMPLE_FILES_DIR, 'English', 'Sample Audio.mp3'), join(workspace, 'sample.mp3'));
  await writeFile(join(workspace, 'rule.mdc'), RULE);
  const application = await electron.launch({ executablePath, args: [`--user-data-dir=${join(temporary, 'data')}`, `--extensions-dir=${join(temporary, 'extensions')}`, `--extensionDevelopmentPath=${resolve(__dirname, '..')}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', workspace, join(workspace, file)], timeout: 60_000 });
  await keepElectronInBackground(application);
  const page = await application.firstWindow();
  return { application, page, workspace, temporary };
}

test('mp4 preview plays an H.264/AAC video', async () => {
  const { application, page, temporary } = await launch('sample.mp4');
  try {
    const video = (await findFrame(page, 'video')).locator('video');
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration), { timeout: 30_000 }).toBeGreaterThan(1.5);
    await video.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
  } finally { await terminateElectron(application); await rm(temporary, { recursive: true, force: true }); }
});

test('mp3 plays in the audio player with a live spectrum', async () => {
  const { application, page, temporary } = await launch('sample.mp3');
  try {
    const frame = await findFrame(page, '.preview-audio-viewer');
    const viewer = frame.locator('.preview-audio-viewer');
    await expect(viewer.locator('.preview-media-time')).toHaveText(/^0:00 \/ (?!0:00)\d+:\d\d$/, { timeout: 30_000 });
    // Keep the run silent: anything routed to the speakers goes through a zero-gain node first.
    await viewer.evaluate(() => {
      const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
      AudioNode.prototype.connect = function silenced(this: AudioNode, ...args: unknown[]) {
        if (!(args[0] instanceof AudioDestinationNode)) return connect.apply(this, args);
        const mute = this.context.createGain();
        mute.gain.value = 0;
        connect.call(this, mute);
        return connect.call(mute, args[0]);
      } as typeof AudioNode.prototype.connect;
    });
    await viewer.locator('.preview-media-play').click();
    await expect.poll(() => viewer.locator('.preview-audio-spectrum').evaluate((canvas: HTMLCanvasElement) => {
      const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let rows = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 0) { rows += 1; break; }
      }
      return rows / height;
    }), { timeout: 10_000 }).toBeGreaterThan(0.3);
  } finally { await terminateElectron(application); await rm(temporary, { recursive: true, force: true }); }
});

test('.mdc opens in the EasyView Markdown editor without rewriting the file', async () => {
  const { application, page, workspace, temporary } = await launch('rule.mdc');
  try {
    const frame = await findFrame(page, '.ProseMirror h1');
    await expect(frame.locator('.ProseMirror h1')).toContainText('Release rule');
    await expect(frame.locator('.frontmatter-row').filter({ hasText: 'description' })).toContainText('Release rule');
    await page.waitForTimeout(1500);
    expect(await readFile(join(workspace, 'rule.mdc'), 'utf8')).toBe(RULE);
  } finally { await terminateElectron(application); await rm(temporary, { recursive: true, force: true }); }
});
