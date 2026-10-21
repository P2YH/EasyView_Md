const path = require('node:path');
const { MakerZIP } = require('@electron-forge/maker-zip');

const appDir = __dirname;

/**
 * Keep only the runtime-required contents inside app.asar.
 *
 * The renderer/main bundles are produced by esbuild (bundle: true) into dist/,
 * so the only external module needed at runtime is node-pty (native addon),
 * which is staged into apps/desktop/node_modules by scripts/prepare-runtime.mjs.
 * Everything else (src/ sources, scripts, tests, historical single-file
 * artifacts, build tooling) is compile-time only and must not be packaged.
 */
// Runtime contents only. icon / java-decompiler are read via packager
// options (icon / extraResource) from the source tree, not from app.asar.
const KEEP_TOP_LEVEL = new Set(['dist', 'node_modules', 'package.json']);

function shouldIgnore(filePath) {
  // electron-packager passes paths relative to the app dir with a leading
  // slash, e.g. "/package.json", "/dist/main/main.js" (see copy-filter.js).
  // That leading slash must NOT be treated as a filesystem absolute path —
  // path.isAbsolute("/package.json") is true on POSIX and would wrongly
  // resolve outside the app directory.
  const relative = String(filePath ?? '').replace(/^[\\/]+/, '');
  if (!relative) return false; // app root itself
  const top = relative.split(/[\\/]+/).filter(Boolean)[0];
  return !KEEP_TOP_LEVEL.has(top);
}

/** EASYVIEW_MAC_SIGN_IDENTITY wins ("-" forces ad-hoc); otherwise the first local Developer ID / Apple Development identity. */
function macSigningIdentity(execFileSync) {
  const configured = process.env.EASYVIEW_MAC_SIGN_IDENTITY?.trim();
  if (configured) return configured;
  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const names = [...output.matchAll(/^\s*\d+\)\s+[0-9A-F]{40}\s+"([^"]+)"/gm)].map((match) => match[1]);
    return names.find((name) => name.startsWith('Developer ID Application:'))
      ?? names.find((name) => name.startsWith('Apple Development:'))
      ?? '-';
  } catch {
    return '-';
  }
}

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/node-pty/**/*' },
    prune: false,
    ignore: shouldIgnore,
    extraResource: [path.resolve(appDir, 'resources/java-decompiler')],
    name: 'EasyView_Md',
    appBundleId: 'com.easyview.md',
    icon: path.resolve(appDir, 'assets/icon'),
    // Shown in Windows file properties and Task Manager; Electron's default CompanyName is "GitHub, Inc.".
    win32metadata: {
      CompanyName: 'EasyView_Md',
      ProductName: 'EasyView_Md',
      FileDescription: 'EasyView_Md',
    },
    extendInfo: {
      CFBundleDisplayName: 'EasyView_Md',
      CFBundleName: 'EasyView_Md',
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Markdown Document',
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Alternate',
          CFBundleTypeExtensions: ['md', 'markdown', 'mdx'],
        },
      ],
    },
  },
  rebuildConfig: {
    onlyModules: [],
  },
  hooks: {
    // Electron binaries are only linker-signed (ad-hoc) and leave the bundle resources unsealed,
    // which `codesign --verify --deep --strict` rejects and Gatekeeper may report as "damaged".
    // Seal the whole bundle. Prefer a stable keychain identity: an ad-hoc signature's designated
    // requirement is the cdhash, which changes on every build, so the Keychain re-prompts for
    // "EasyView_Md Safe Storage" after each reinstall. Fall back to ad-hoc when none is available.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      const { execFileSync } = require('node:child_process');
      const fs = require('node:fs');
      const identity = macSigningIdentity(execFileSync);
      console.log(`[easyview-desktop] codesign identity: ${identity === '-' ? 'ad-hoc' : identity}`);
      for (const outputPath of outputPaths) {
        for (const entry of fs.readdirSync(outputPath)) {
          if (!entry.endsWith('.app')) continue;
          const app = path.join(outputPath, entry);
          execFileSync('codesign', ['--force', '--deep', '--sign', identity, app], { stdio: 'inherit' });
          execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
        }
      }
    },
  },
  makers: [
    new MakerZIP({}, ['darwin', 'win32']),
  ],
};
