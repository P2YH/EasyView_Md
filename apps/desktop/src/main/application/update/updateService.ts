import { app, BrowserWindow, dialog, net, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../help/appLogger';
import {
  assetDownloadSources, compareVersions, DEFAULT_UPDATE_SETTINGS, isUpdateDisabled, LATEST_RELEASE_API, LATEST_RELEASE_PAGE, normalizeUpdateSettings,
  parseGitHubRelease, parseReleaseFromTagUrl, parseSha256Sums, type ReleaseAsset, type ReleaseInfo, selectInstallerAsset, shouldPrompt,
  trimNotes, type UpdateSettings, WEBSITE_URL,
} from './updateCore';
import { cleanupUpdateDirectory, findVerifiedDownload } from './updateStorage';
import { tUpdate } from './updateService.i18n';

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_STALL_MS = 60_000;
const DOWNLOAD_MAX_ATTEMPTS = 6;

let settings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS };
let checking = false;
let download: { version: string; controller: AbortController } | undefined;
let menuRefresher: () => void = () => {};
const ulog = (level: 'info' | 'warn' | 'error', message: string) => log(level, 'update', message);

const settingsPath = () => path.join(app.getPath('userData'), 'update-settings.json');
const updatesRoot = () => path.join(app.getPath('userData'), 'updates');

export function updatesDisabled(): boolean {
  return isUpdateDisabled({ windowsStore: process.windowsStore, mas: process.mas, disableFlag: process.env.EASYVIEW_DISABLE_UPDATE_CHECK });
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
  let apiError: unknown;
  try {
    const response = await fetchWithTimeout(LATEST_RELEASE_API, 'application/vnd.github+json');
    const release = parseGitHubRelease(await response.json());
    if (release) return release;
    apiError = new Error('latest release is missing, a draft/prerelease, or has an invalid tag');
  } catch (error) {
    apiError = error;
  }
  ulog('warn', `release API unavailable, falling back to release page: ${String(apiError)}`);
  try {
    const response = await fetchWithTimeout(LATEST_RELEASE_PAGE, 'text/html');
    void response.body?.cancel();
    const release = parseReleaseFromTagUrl(response.url);
    if (release) return release;
    throw new Error(`unexpected release page url ${response.url}`);
  } catch (error) {
    ulog('warn', `release page fallback failed: ${String(error)}`);
    throw apiError;
  }
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
    if (manual) await showBox({ type: 'info', message: tUpdate('storeManaged') });
    return;
  }
  if (checking) return;
  if (download) {
    if (manual) await showBox({ type: 'info', message: tUpdate('downloading', { version: download.version }) });
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
      if (manual) await showBox({ type: 'info', message: tUpdate('upToDate'), detail: `EasyView ${current}` });
      return;
    }
    await promptForRelease(release, current);
  } catch (error) {
    ulog(manual ? 'warn' : 'info', `update check failed: ${String(error)}`);
    if (manual) await showBox({ type: 'error', message: tUpdate('checkFailed'), detail: String(error instanceof Error ? error.message : error) });
  } finally {
    checking = false;
  }
}

async function promptForRelease(release: ReleaseInfo, current: string): Promise<void> {
  const asset = selectInstallerAsset(release.assets, { platform: process.platform, arch: process.arch, windowsInstalled: windowsInstalled() });
  const choices = [...(asset ? ['download' as const] : []), 'website' as const, 'later' as const, 'skip' as const];
  const { response } = await showBox({
    type: 'info',
    title: tUpdate('prompt.title'),
    message: tUpdate('prompt.message', { version: release.version, current }),
    detail: trimNotes(release.notes) || release.htmlUrl,
    buttons: choices.map((choice) => tUpdate(`prompt.${choice}`)),
    defaultId: 0,
    cancelId: choices.indexOf('later'),
    noLink: true,
  });
  const choice = choices[response];
  ulog('info', `user chose "${choice}" for ${release.version}`);
  if (choice === 'download' && asset) void downloadUpdate(release, asset);
  else if (choice === 'website') void shell.openExternal(WEBSITE_URL);
  else if (choice === 'skip') await saveSettings({ skippedVersion: release.version });
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
  let lastError: unknown;
  for (const source of assetDownloadSources(sums)) {
    try {
      const expected = parseSha256Sums(await (await fetchWithTimeout(source.url, source.accept)).text()).get(assetName);
      if (!expected) throw new Error(`SHA256SUMS has no entry for ${assetName}`);
      return expected;
    } catch (error) {
      lastError = error;
      ulog('warn', `SHA256SUMS from ${new URL(source.url).host} failed: ${String(error)}`);
    }
  }
  throw lastError;
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

async function downloadUpdate(release: ReleaseInfo, asset: ReleaseAsset): Promise<void> {
  if (download) return;
  const controller = new AbortController();
  download = { version: release.version, controller };
  menuRefresher();
  const dir = path.join(updatesRoot(), release.version);
  const finalPath = path.join(dir, asset.name);
  const partPath = `${finalPath}.part`;
  let stallTimer: NodeJS.Timeout | undefined;
  let attemptController: AbortController | undefined;
  const armStall = () => {
    clearTimeout(stallTimer);
    const current = attemptController;
    stallTimer = setTimeout(() => current?.abort(new Error('download stalled')), DOWNLOAD_STALL_MS);
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
      const sources = assetDownloadSources(asset);
      const hash = createHash('sha256');
      const out = createWriteStream(partPath);
      const closed = new Promise<void>((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
      let received = 0;
      let total = asset.size;
      try {
        // Each attempt resumes after the bytes already hashed and written, rotating through the sources.
        for (let attempt = 0; ; attempt += 1) {
          const source = sources[attempt % sources.length];
          attemptController = new AbortController();
          try {
            armStall();
            const response = await net.fetch(source.url, {
              signal: AbortSignal.any([controller.signal, attemptController.signal]),
              headers: {
                'User-Agent': `EasyView_Md/${app.getVersion()}`,
                Accept: source.accept,
                ...(received > 0 ? { Range: `bytes=${received}-` } : {}),
              },
            });
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${asset.name}`);
            if (received > 0 && response.status !== 206) throw new Error(`HTTP ${response.status} instead of 206 resuming at byte ${received}`);
            if (received === 0) total = Number(response.headers.get('content-length')) || asset.size;
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
            if (total > 0 && received < total) throw new Error(`connection closed at byte ${received} of ${total}`);
            break;
          } catch (error) {
            if (controller.signal.aborted || attempt + 1 >= DOWNLOAD_MAX_ATTEMPTS) throw error;
            ulog('warn', `download attempt ${attempt + 1} via ${new URL(source.url).host} failed at byte ${received}: ${String(error)}`);
            clearTimeout(stallTimer);
            await sleep(Math.min(2_000 * (attempt + 1), 10_000), controller.signal);
            if (controller.signal.aborted) throw error;
          }
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
      message: tUpdate('installer.opened', { version: release.version }),
      detail: tUpdate(process.platform === 'darwin' ? 'installer.macDetail' : 'installer.detail'),
    });
  } catch (error) {
    const cancelled = controller.signal.aborted && String(controller.signal.reason).includes('cancelled');
    ulog(cancelled ? 'info' : 'error', `download ${cancelled ? 'cancelled' : 'failed'}: ${String(error)}`);
    await rm(partPath, { force: true });
    setProgress(-1);
    if (!cancelled) {
      const { response } = await showBox({ type: 'error', message: tUpdate('download.failed'), detail: String(error instanceof Error ? error.message : error), buttons: [tUpdate('prompt.website'), tUpdate('download.close')], defaultId: 0, cancelId: 1 });
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
    if (process.env.EASYVIEW_DISABLE_UPDATE_CHECK) {
      ulog('info', 'update checks disabled by EASYVIEW_DISABLE_UPDATE_CHECK');
      return;
    }
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
