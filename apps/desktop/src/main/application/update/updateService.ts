import { app, BrowserWindow, dialog, net, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../help/appLogger';
import {
  assetDownloadSources, compareVersions, DEFAULT_UPDATE_SETTINGS, isUpdateDisabled, LATEST_RELEASE_API, LATEST_RELEASE_PAGE, MIRROR_RELEASE_MANIFEST,
  normalizeUpdateSettings, parseGitHubRelease, parseMirrorRelease, parseReleaseFromTagUrl, parseSha256Sums, type ReleaseAsset, type ReleaseInfo,
  selectInstallerAsset, shouldPrompt, trimNotes, type UpdateSettings, WEBSITE_URL, windowsInstallKind, withMirrorAssets,
} from './updateCore';
import { installOnQuit, replaceableBundle, stageFromDmg } from './macAppUpdate';
import {
  closeUpdateProgressDialog, openUpdateProgressDialog, setUpdateDialogCancelHandler, setUpdateProgressPercent,
  setUpdateProgressState, updateDialogParent, waitForUpdateDialogAction,
} from './updateProgressDialog';
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

// release.json has no Cache-Control, so Chromium's heuristic cache would serve a stale version for hours.
async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const response = await net.fetch(url, {
    headers: { Accept: accept, 'User-Agent': `EasyView_Md/${app.getVersion()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  return response;
}

// net.fetch leaves Response.url empty after following redirects and rejects redirect: 'manual'.
function redirectTarget(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual', cache: 'no-store' });
    const timer = setTimeout(() => { request.abort(); reject(new Error(`timed out resolving ${new URL(url).pathname}`)); }, REQUEST_TIMEOUT_MS);
    const settle = (finish: () => void) => { clearTimeout(timer); request.abort(); finish(); };
    request.on('redirect', (_status, _method, redirectUrl) => settle(() => resolve(redirectUrl)));
    request.on('response', (response) => settle(() => reject(new Error(`HTTP ${response.statusCode} without redirect for ${new URL(url).pathname}`))));
    request.on('error', (error) => settle(() => reject(error)));
    request.setHeader('User-Agent', `EasyView_Md/${app.getVersion()}`);
    request.end();
  });
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
    const target = await redirectTarget(LATEST_RELEASE_PAGE);
    const release = parseReleaseFromTagUrl(target);
    if (release) return release;
    throw new Error(`unexpected release page url ${target}`);
  } catch (error) {
    ulog('warn', `release page fallback failed: ${String(error)}`);
  }
  try {
    const release = await fetchMirrorRelease();
    ulog('info', `using website mirror release ${release.version}`);
    return release;
  } catch (error) {
    ulog('warn', `website mirror fallback failed: ${String(error)}`);
    throw apiError;
  }
}

async function fetchMirrorRelease(): Promise<ReleaseInfo> {
  const release = parseMirrorRelease(await (await fetchWithTimeout(MIRROR_RELEASE_MANIFEST, 'application/json')).json());
  if (!release) throw new Error('website release.json is missing a valid desktopVersion');
  return release;
}

async function attachMirror(release: ReleaseInfo): Promise<ReleaseInfo> {
  try {
    const mirror = await fetchMirrorRelease();
    if (compareVersions(mirror.version, release.version) !== 0) ulog('info', `website mirror has ${mirror.version}, not ${release.version}; not using it`);
    return withMirrorAssets(release, mirror);
  } catch (error) {
    ulog('warn', `website mirror unavailable: ${String(error)}`);
    return release;
  }
}

function windowsInstalled(): boolean {
  return process.platform === 'win32' && windowsInstallKind(process.execPath, existsSync) !== 'portable';
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
  if (value >= 0) setUpdateProgressPercent(Math.round(value * 100));
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
  const title = tUpdate('prompt.title');
  await openUpdateProgressDialog(updateDialogParent());
  setUpdateProgressState({ phase: 'downloading', title, message: tUpdate('downloading', { version: release.version }), percent: 0 });
  setUpdateDialogCancelHandler(() => cancelUpdateDownload());
  try {
    await cleanupUpdateDirectory({ root: updatesRoot(), currentVersion: app.getVersion(), keepVersion: release.version, maxRetained: 1, log: (m) => ulog('info', `cleanup: ${m}`) });
    await mkdir(dir, { recursive: true });
    const mirrored = await attachMirror(release);
    const expected = await fetchExpectedChecksum(mirrored, asset.name);
    const reused = await findVerifiedDownload(finalPath, expected, (m) => ulog('warn', m));
    if (reused) {
      ulog('info', `reusing verified download ${asset.name}`);
      setUpdateProgressState({ phase: 'downloading', title, message: tUpdate('downloading', { version: release.version }), percent: 100 });
    } else {
      const sources = assetDownloadSources(mirrored.assets.find((candidate) => candidate.name === asset.name) ?? asset);
      ulog('info', `downloading ${asset.name} (${asset.size} bytes) to ${dir} via ${sources.map((source) => new URL(source.url).host).join(', ')}`);
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
    if (process.platform === 'darwin' && await finishMacInPlaceUpdate(release.version, finalPath, path.join(dir, 'EasyView_Md.app'))) return;
    await finishInstallerUpdate(release.version, finalPath);
  } catch (error) {
    const cancelled = controller.signal.aborted && String(controller.signal.reason).includes('cancelled');
    ulog(cancelled ? 'info' : 'error', `download ${cancelled ? 'cancelled' : 'failed'}: ${String(error)}`);
    await rm(partPath, { force: true });
    setProgress(-1);
    if (cancelled) {
      closeUpdateProgressDialog();
    } else {
      setUpdateProgressState({
        phase: 'failed',
        title,
        message: tUpdate('download.failed'),
        detail: String(error instanceof Error ? error.message : error),
      });
      const action = await waitForUpdateDialogAction();
      closeUpdateProgressDialog();
      if (action === 'website') void shell.openExternal(WEBSITE_URL);
    }
  } finally {
    clearTimeout(stallTimer);
    setUpdateDialogCancelHandler(undefined);
    download = undefined;
    menuRefresher();
  }
}

/** Stages the DMG into the running bundle and waits for Restart/Later in the same progress dialog. */
async function finishMacInPlaceUpdate(version: string, dmgPath: string, stagedApp: string): Promise<boolean> {
  const target = await replaceableBundle();
  if (!target) {
    ulog('info', `in-place update unavailable for ${process.execPath}; offering the installer instead`);
    return false;
  }
  const title = tUpdate('prompt.title');
  let cancelled = false;
  setUpdateDialogCancelHandler(() => { cancelled = true; cancelUpdateDownload(); });
  setUpdateProgressState({ phase: 'preparing', title, message: tUpdate('progress.preparing', { version }) });
  try {
    await stageFromDmg(dmgPath, stagedApp);
  } catch (error) {
    ulog('warn', `staging ${version} from DMG failed, offering the installer instead: ${String(error)}`);
    return false;
  }
  if (cancelled) {
    closeUpdateProgressDialog();
    return true;
  }
  setUpdateDialogCancelHandler(undefined);
  setUpdateProgressState({
    phase: 'ready',
    title,
    message: tUpdate('ready.message', { version }),
    detail: tUpdate('ready.detail'),
    readyAction: 'restart',
  });
  const action = await waitForUpdateDialogAction();
  const relaunch = action === 'restart';
  installOnQuit(target, stagedApp, relaunch);
  ulog('info', `${version} staged; replacing ${target} on quit${relaunch ? ' and relaunching now' : ''}`);
  closeUpdateProgressDialog();
  if (relaunch) app.quit();
  return true;
}

/** Keeps the progress dialog open until the user installs or dismisses; then opens the downloaded installer. */
async function finishInstallerUpdate(version: string, installerPath: string): Promise<void> {
  const title = tUpdate('prompt.title');
  setUpdateDialogCancelHandler(undefined);
  setUpdateProgressState({
    phase: 'ready',
    title,
    message: tUpdate('ready.message', { version }),
    detail: tUpdate('ready.installDetail'),
    readyAction: 'install',
  });
  const action = await waitForUpdateDialogAction();
  closeUpdateProgressDialog();
  if (action !== 'install') return;
  const openError = await shell.openPath(installerPath);
  if (openError) throw new Error(`failed to open installer: ${openError}`);
  if (process.platform === 'win32') app.quit();
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
