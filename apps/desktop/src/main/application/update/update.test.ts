import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, isUpdateDisabled, normalizeUpdateSettings, parseGitHubRelease, parseSha256Sums, selectInstallerAsset, shouldPrompt, trimNotes } from './updateCore';
import { cleanupUpdateDirectory, findVerifiedDownload } from './updateStorage';

const assets = ['EasyView_Md-mac-arm64.dmg', 'EasyView_Md-mac-arm64.zip', 'EasyView_Md-win-x64-setup.exe', 'EasyView_Md-win-x64.zip', 'EasyView_Md-win-x64-store.appx', 'SHA256SUMS']
  .map((name) => ({ name, url: `https://x/${name}`, size: 1 }));

describe('compareVersions', () => {
  it('orders semver', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.5', '2.0.5')).toBe(0);
    expect(compareVersions('2.0.5', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('2.1.0-beta.1', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('garbage', '2.0.0')).toBe(0);
  });
});

describe('parseGitHubRelease', () => {
  it('parses and ignores drafts/prereleases', () => {
    const base = { tag_name: 'v2.0.6', body: 'notes', html_url: 'h', assets: [{ name: 'a', browser_download_url: 'u', size: 3 }] };
    expect(parseGitHubRelease(base)).toMatchObject({ version: '2.0.6', assets: [{ name: 'a', url: 'u', size: 3 }] });
    expect(parseGitHubRelease({ ...base, draft: true })).toBeUndefined();
    expect(parseGitHubRelease({ ...base, prerelease: true })).toBeUndefined();
    expect(parseGitHubRelease({ ...base, tag_name: 'v2.0.6-rc.1' })).toBeUndefined();
    expect(parseGitHubRelease(null)).toBeUndefined();
  });
});

describe('selectInstallerAsset', () => {
  it('picks by platform/arch, website otherwise', () => {
    expect(selectInstallerAsset(assets, { platform: 'darwin', arch: 'arm64', windowsInstalled: false })?.name).toBe('EasyView_Md-mac-arm64.dmg');
    expect(selectInstallerAsset(assets, { platform: 'win32', arch: 'x64', windowsInstalled: true })?.name).toBe('EasyView_Md-win-x64-setup.exe');
    expect(selectInstallerAsset(assets, { platform: 'win32', arch: 'x64', windowsInstalled: false })).toBeUndefined();
    expect(selectInstallerAsset(assets, { platform: 'darwin', arch: 'x64', windowsInstalled: false })).toBeUndefined();
    expect(selectInstallerAsset(assets, { platform: 'linux', arch: 'x64', windowsInstalled: false })).toBeUndefined();
  });
});

describe('parseSha256Sums', () => {
  it('parses both sha256sum formats', () => {
    const h = 'a'.repeat(64);
    const map = parseSha256Sums(`${h}  EasyView_Md-mac-arm64.dmg\r\n${'B'.repeat(64)} *dist/x.exe\nbad line\n`);
    expect(map.get('EasyView_Md-mac-arm64.dmg')).toBe(h);
    expect(map.get('x.exe')).toBe('b'.repeat(64));
    expect(map.size).toBe(2);
  });
});

describe('store / settings / prompt', () => {
  it('disables for store builds', () => {
    expect(isUpdateDisabled({ windowsStore: true })).toBe(true);
    expect(isUpdateDisabled({ mas: true })).toBe(true);
    expect(isUpdateDisabled({})).toBe(false);
    expect(isUpdateDisabled({ disableFlag: '1' })).toBe(true);
    expect(isUpdateDisabled({ disableFlag: '0' })).toBe(false);
    expect(isUpdateDisabled({ disableFlag: 'false' })).toBe(false);
    expect(isUpdateDisabled({ disableFlag: '' })).toBe(false);
  });
  it('normalizes settings and respects skip only for automatic checks', () => {
    const s = normalizeUpdateSettings({ autoCheck: 'x', skippedVersion: '2.0.6', lastCheckAt: 5 });
    expect(s).toEqual({ autoCheck: true, skippedVersion: '2.0.6', lastCheckAt: 5 });
    const release = { version: '2.0.6', tag: 'v2.0.6', notes: '', htmlUrl: '', assets: [] };
    expect(shouldPrompt(release, '2.0.5', s, false)).toBe(false);
    expect(shouldPrompt(release, '2.0.5', s, true)).toBe(true);
    expect(shouldPrompt(release, '2.0.6', s, true)).toBe(false);
    expect(trimNotes('a\n\n\n\nb<!-- x -->', 100)).toBe('a\n\nb');
  });
});

describe('cleanupUpdateDirectory', () => {
  it('removes old versions, stale parts, junk and over-cap versions', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ev-upd-'));
    for (const v of ['2.0.4', '2.0.5', '2.0.6', '2.0.7']) mkdirSync(path.join(root, v));
    writeFileSync(path.join(root, '2.0.7', 'a.dmg'), 'x');
    writeFileSync(path.join(root, '2.0.7', 'a.dmg.part'), 'x');
    writeFileSync(path.join(root, 'junk.txt'), 'x');
    const removed = await cleanupUpdateDirectory({ root, currentVersion: '2.0.5', maxRetained: 1 });
    expect(removed.length).toBe(5);
    expect(existsSync(path.join(root, '2.0.7', 'a.dmg'))).toBe(true);
    for (const gone of ['2.0.4', '2.0.5', '2.0.6', 'junk.txt', '2.0.7/a.dmg.part']) expect(existsSync(path.join(root, gone))).toBe(false);
  });
  it('keeps keepVersion and tolerates missing root', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ev-upd-'));
    for (const v of ['2.0.6', '2.0.7']) mkdirSync(path.join(root, v));
    await cleanupUpdateDirectory({ root, currentVersion: '2.0.5', keepVersion: '2.0.6', maxRetained: 1 });
    expect(existsSync(path.join(root, '2.0.6'))).toBe(true);
    expect(existsSync(path.join(root, '2.0.7'))).toBe(true);
    expect(await cleanupUpdateDirectory({ root: path.join(root, 'nope'), currentVersion: '1.0.0' })).toEqual([]);
  });
  it('reuses verified download and deletes corrupted one', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ev-upd-'));
    const file = path.join(root, 'x.dmg');
    writeFileSync(file, 'hello');
    const good = createHash('sha256').update('hello').digest('hex');
    expect(await findVerifiedDownload(file, good)).toBe(file);
    expect(await findVerifiedDownload(file, 'f'.repeat(64))).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });
});
