export const UPDATE_REPO = 'tiantianmanmanzou/EasyView_Md';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const WEBSITE_URL = 'https://easyview.wonderxy.art';

export interface ReleaseAsset { name: string; url: string; size: number }
export interface ReleaseInfo { version: string; tag: string; notes: string; htmlUrl: string; assets: ReleaseAsset[] }

/** Parses "v1.2.3" / "1.2.3" / "1.2.3-beta.1". Returns undefined if not semver-like. */
export function parseVersion(value: string): { core: number[]; pre: string } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(value.trim());
  if (!match) return undefined;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' };
}

/** Returns >0 if a > b, <0 if a < b, 0 if equal or unparsable. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (let i = 0; i < 3; i += 1) if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

export function trimNotes(notes: string, maxLength = 1200): string {
  const clean = notes.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}\n…` : clean;
}

/** Converts a GitHub release API payload into ReleaseInfo, ignoring drafts/prereleases/invalid tags. */
export function parseGitHubRelease(payload: unknown): ReleaseInfo | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw = payload as Record<string, unknown>;
  if (raw.draft === true || raw.prerelease === true) return undefined;
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
  const parsed = parseVersion(tag);
  if (!parsed || parsed.pre) return undefined;
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  return {
    version: parsed.core.join('.'),
    tag,
    notes: typeof raw.body === 'string' ? raw.body : '',
    htmlUrl: typeof raw.html_url === 'string' ? raw.html_url : `https://github.com/${UPDATE_REPO}/releases/tag/${tag}`,
    assets: assets.flatMap((item) => {
      const asset = item as Record<string, unknown>;
      return typeof asset?.name === 'string' && typeof asset.browser_download_url === 'string'
        ? [{ name: asset.name, url: asset.browser_download_url, size: typeof asset.size === 'number' ? asset.size : 0 }]
        : [];
    }),
  };
}

export interface PlatformInfo { platform: string; arch: string; windowsInstalled: boolean }

/** Picks the installer asset for this platform; undefined means "open the website instead". */
export function selectInstallerAsset(assets: ReleaseAsset[], info: PlatformInfo): ReleaseAsset | undefined {
  let name: string | undefined;
  if (info.platform === 'darwin' && info.arch === 'arm64') name = 'EasyView_Md-mac-arm64.dmg';
  else if (info.platform === 'win32' && info.arch === 'x64' && info.windowsInstalled) name = 'EasyView_Md-win-x64-setup.exe';
  return name ? assets.find((asset) => asset.name === name) : undefined;
}

/** Parses `sha256sum` output ("<hex>  name" or "<hex> *name"). */
export function parseSha256Sums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match) result.set(match[2].replace(/^.*[\\/]/, ''), match[1].toLowerCase());
  }
  return result;
}

export interface UpdateEnvironment { windowsStore?: boolean; mas?: boolean; isPackaged?: boolean }

/** Store builds (Microsoft Store / Mac App Store) must never self-update. */
export function isUpdateDisabled(env: UpdateEnvironment): boolean {
  return env.windowsStore === true || env.mas === true;
}

export interface UpdateSettings { autoCheck: boolean; skippedVersion?: string; lastCheckAt?: number }
export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { autoCheck: true };

export function normalizeUpdateSettings(value: unknown): UpdateSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    autoCheck: typeof raw.autoCheck === 'boolean' ? raw.autoCheck : true,
    skippedVersion: typeof raw.skippedVersion === 'string' && parseVersion(raw.skippedVersion) ? raw.skippedVersion : undefined,
    lastCheckAt: typeof raw.lastCheckAt === 'number' && Number.isFinite(raw.lastCheckAt) ? raw.lastCheckAt : undefined,
  };
}

/** Whether an automatic check should prompt for this release. Manual checks ignore the skip. */
export function shouldPrompt(release: ReleaseInfo, currentVersion: string, settings: UpdateSettings, manual: boolean): boolean {
  if (compareVersions(release.version, currentVersion) <= 0) return false;
  return manual || settings.skippedVersion !== release.version;
}
