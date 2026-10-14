import { app, BrowserWindow, dialog, net, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../help/appLogger';
import {
  compareVersions, DEFAULT_UPDATE_SETTINGS, isUpdateDisabled, LATEST_RELEASE_API, normalizeUpdateSettings,
  parseGitHubRelease, parseSha256Sums, type ReleaseAsset, type ReleaseInfo, selectInstallerAsset, shouldPrompt,
  trimNotes, type UpdateSettings, WEBSITE_URL,
} from './updateCore';
import { cleanupUpdateDirectory, findVerifiedDownload } from './updateStorage';

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_STALL_MS = 60_000;

let settings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS };
let checking = false;
let download: { version: string; controller: AbortController } | undefined;
let menuRefresher: () => void = () => {};
const ulog = (level: 'info' | 'warn' | 'error', message: string) => log(level, 'update', message);

const settingsPath = () => path.join(app.getPath('userData'), 'update-settings.json');
const updatesRoot = () => path.join(app.getPath('userData'), 'updates');

export function updatesDisabled(): boolean {
  return isUpdateDisabled({ windowsStore: process.windowsStore, mas: process.mas });
}
export function setUpdateMenuRefresher(refresh: () => void): void { menuRefresher = refresh; }
export function getUpdateSettings(): UpdateSettings { return settings; }
export function isDownloadingUpdate(): boolean { return Boolean(download); }

async function loadSettings(): Promise<void> {
  try {
    settings = normalizeUpdateSettings(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ulog('warn', `settings unreadable, using defaults: ${String(error)}`);
  }
}

async function saveSettings(patch: Partial<UpdateSettings>): Promise<void> {
  settings = { ...settings, ...patch };
  const target = settingsPath();
  const temp = `${target}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
    await rename(temp, target);
  } catch (error) {
    ulog('warn', `failed to save settings: ${String(error)}`);
  }
}

export async function setAutoCheck(enabled: boolean): Promise<void> {
  await saveSettings({ autoCheck: enabled });
  ulog('info', `auto check ${enabled ? 'enabled' : 'disabled'}`);
  menuRefresher();
}

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const response = await net.fetch(url, {
    headers: { Accept: accept, 'User-Agent': `EasyView_Md/${app.getVersion()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  return response;
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const response = await fetchWithTimeout(LATEST_RELEASE_API, 'application/vnd.github+json');
  const release = parseGitHubRelease(await response.json());
  if (!release) throw new Error('latest release is missing, a draft/prerelease, or has an invalid tag');
  return release;
}

function windowsInstalled(): boolean {
  // Squirrel installs put Update.exe one level above app-x.y.z\EasyView_Md.exe; the zip build has none.
  return process.platform === 'win32' && existsSync(path.resolve(path.dirname(process.execPath), '..', 'Update.exe'));
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function showBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const window = focusedWindow();
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  if (updatesDisabled()) {
    if (manual) await showBox({ type: 'info', message: '此版本由应用商店更新 / Updates are managed by the store.' });
    return;
  }
  if (checking) return;
  if (download) {
    if (manual) await showBox({ type: 'info', message: `正在下载 v${download.version}… / Downloading v${download.version}…` });
    return;
  }
  checking = true;
  const current = app.getVersion();
  try {
    ulog('info', `checking for updates (current ${current}, ${manual ? 'manual' : 'automatic'})`);
    const release = await fetchLatestRelease();
    await saveSettings({ lastCheckAt: Date.now() });
    ulog('info', `latest release ${release.version}`);
    if (!shouldPrompt(release, current, settings, manual)) {
      if (compareVersions(release.version, current) > 0) ulog('info', `version ${release.version} skipped by user`);
      if (manual) await showBox({ type: 'info', message: '已是最新版本 / You are up to date', detail: `EasyView ${current}` });
      return;
    }
    await promptForRelease(release, current);
  } catch (error) {
    ulog(manual ? 'warn' : 'info', `update check failed: ${String(error)}`);
    if (manual) await showBox({ type: 'error', message: '检查更新失败 / Update check failed', detail: String(error instanceof Error ? error.message : error) });
  } finally {
    checking = false;
  }
}

async function promptForRelease(release: ReleaseInfo, current: string): Promise<void> {
  const asset = selectInstallerAsset(release.assets, { platform: process.platform, arch: process.arch, windowsInstalled: windowsInstalled() });
  const buttons = [...(asset ? ['下载并安装 / Download'] : []), '打开官网 / Website', '稍后提醒 / Later', '跳过此版本 / Skip'];
  const { response } = await showBox({
    type: 'info',
    title: 'EasyView 更新 / Update',
    message: `发现新版本 v${release.version}（当前 v${current}）\nNew version v${release.version} is available`,
    detail: trimNotes(release.notes) || release.htmlUrl,
    buttons,
    defaultId: 0,
    cancelId: buttons.indexOf('稍后提醒 / Later'),
    noLink: true,
  });
  const choice = buttons[response];
  ulog('info', `user chose "${choice}" for ${release.version}`);
  if (choice.startsWith('下载') && asset) void downloadUpdate(release, asset);
  else if (choice.startsWith('打开官网')) void shell.openExternal(WEBSITE_URL);
  else if (choice.startsWith('跳过')) await saveSettings({ skippedVersion: release.version });
}

function setProgress(value: number): void {
  for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(value);
}

export function cancelUpdateDownload(): void {
  if (!download) return;
  ulog('info', `cancelling download of ${download.version}`);
  download.controller.abort(new Error('cancelled'));
}

async function fetchExpectedChecksum(release: ReleaseInfo, assetName: string): Promise<string> {
  const sums = release.assets.find((asset) => asset.name === 'SHA256SUMS');
  if (!sums) throw new Error('release has no SHA256SUMS asset');
  const expected = parseSha256Sums(await (await fetchWithTimeout(sums.url, 'text/plain,application/octet-stream')).text()).get(assetName);
  if (!expected) throw new Error(`SHA256SUMS has no entry for ${assetName}`);
  return expected;
}

async function downloadUpdate(release: ReleaseInfo, asset: ReleaseAsset): Promise<void> {
  if (download) return;
  const controller = new AbortController();
  download = { version: release.version, controller };
  menuRefresher();
  const dir = path.join(updatesRoot(), release.version);
  const finalPath = path.join(dir, asset.name);
  const partPath = `${finalPath}.part`;
  let stallTimer: NodeJS.Timeout | undefined;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error('download stalled')), DOWNLOAD_STALL_MS);
  };
  try {
    await cleanupUpdateDirectory({ root: updatesRoot(), currentVersion: app.getVersion(), keepVersion: release.version, maxRetained: 1, log: (m) => ulog('info', `cleanup: ${m}`) });
    await mkdir(dir, { recursive: true });
    const expected = await fetchExpectedChecksum(release, asset.name);
    const reused = await findVerifiedDownload(finalPath, expected, (m) => ulog('warn', m));
    if (reused) {
      ulog('info', `reusing verified download ${asset.name}`);
    } else {
      ulog('info', `downloading ${asset.name} (${asset.size} bytes) to ${dir}`);
      armStall();
      const response = await net.fetch(asset.url, { signal: controller.signal, headers: { 'User-Agent': `EasyView_Md/${app.getVersion()}` } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${asset.name}`);
      const total = Number(response.headers.get('content-length')) || asset.size;
      const hash = createHash('sha256');
      const out = createWriteStream(partPath);
      const closed = new Promise<void>((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
      let received = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armStall();
          hash.update(value);
          received += value.byteLength;
          if (!out.write(value)) await new Promise<void>((resolve) => { out.once('drain', () => resolve()); });
          if (total > 0) setProgress(Math.min(1, received / total));
        }
      } finally {
        out.end();
        await closed;
      }
      const actual = hash.digest('hex');
      if (actual !== expected) throw new Error(`checksum mismatch for ${asset.name} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
      await rename(partPath, finalPath);
      ulog('info', `downloaded and verified ${asset.name} (${received} bytes)`);
    }
    setProgress(-1);
    const openError = await shell.openPath(finalPath);
    if (openError) throw new Error(`failed to open installer: ${openError}`);
    await showBox({
      type: 'info',
      message: `v${release.version} 安装包已打开 / Installer opened`,
      detail: process.platform === 'darwin'
        ? '请退出 EasyView，将新版本拖入「应用程序」覆盖安装。\nQuit EasyView and drag the new app into Applications.'
        : '请按安装程序提示完成安装，安装时会关闭 EasyView。\nFollow the installer; EasyView will be closed during setup.',
    });
  } catch (error) {
    const cancelled = controller.signal.aborted && String(controller.signal.reason).includes('cancelled');
    ulog(cancelled ? 'info' : 'error', `download ${cancelled ? 'cancelled' : 'failed'}: ${String(error)}`);
    await rm(partPath, { force: true });
    setProgress(-1);
    if (!cancelled) {
      const { response } = await showBox({ type: 'error', message: '更新下载失败 / Download failed', detail: String(error instanceof Error ? error.message : error), buttons: ['打开官网 / Website', '关闭 / Close'], defaultId: 0, cancelId: 1 });
      if (response === 0) void shell.openExternal(WEBSITE_URL);
    }
  } finally {
    clearTimeout(stallTimer);
    download = undefined;
    menuRefresher();
  }
}

export async function startUpdateService(): Promise<void> {
  await loadSettings();
  if (updatesDisabled()) {
    ulog('info', 'store build detected; self-update disabled');
    await rm(updatesRoot(), { recursive: true, force: true }).catch(() => {});
    return;
  }
  await cleanupUpdateDirectory({ root: updatesRoot(), currentVersion: app.getVersion(), maxRetained: 1, log: (m) => ulog('info', `cleanup: ${m}`) })
    .catch((error) => ulog('warn', `cleanup failed: ${String(error)}`));
  const tick = () => { if (settings.autoCheck) void checkForUpdates(false); };
  setTimeout(tick, FIRST_CHECK_DELAY_MS).unref?.();
  setInterval(tick, CHECK_INTERVAL_MS).unref?.();
  menuRefresher();
}
