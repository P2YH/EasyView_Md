/**
 * electron-builder config used ONLY for the Microsoft Store package (AppX/MSIX).
 *
 * The regular Windows/macOS installers (Squirrel setup.exe + zip) are still
 * produced by Electron Forge (forge.config.cjs). This config re-packages the
 * Forge output (out/EasyView_Md-win32-x64, passed as `prepackaged`) into an
 * .appx via scripts/make-appx.mjs, so the app binaries are identical.
 *
 * Signing: no certificate is configured on purpose. Store submissions do not
 * need to be signed — Partner Center re-signs the package with a Microsoft
 * certificate — and without CSC_LINK / WIN_CSC_LINK / signtool options
 * electron-builder skips signing ("no signing info identified").
 * See https://www.electron.build/appx.html#code-signing
 */
const electronVersion = require('electron/package.json').version;

module.exports = {
  appId: 'com.easyview.md',
  productName: 'EasyView_Md',
  executableName: 'EasyView_Md',
  // Hoisted workspace install: electron-builder can't read the installed
  // Electron version from apps/desktop/node_modules, so pin it explicitly.
  electronVersion,
  npmRebuild: false,
  // Lists EasyView_Md under Explorer's "Open with" for Markdown (uap:FileTypeAssociation).
  fileAssociations: [
    { ext: ['md', 'markdown', 'mdx'], name: 'markdown', description: 'Markdown Document' },
  ],
  directories: {
    // AppX tile assets live in build/appx/ (tooling/brand/generate-appx-assets.mjs).
    buildResources: 'build',
    output: 'out/store',
  },
  win: {
    target: [{ target: 'appx', arch: ['x64'] }],
    // The prepackaged Forge executable is used as-is; never re-sign/re-edit it.
    signAndEditExecutable: false,
  },
  appx: {
    // Values reserved in Partner Center for product 9MTQTBP489CN
    // (PFN wonderxy.EasyViewMd_aeg7cng3hy970). Must match exactly.
    identityName: 'wonderxy.EasyViewMd',
    publisher: 'CN=19709C1F-89CA-4443-8E7F-815C01CEC37E',
    publisherDisplayName: 'wonderxy',
    displayName: 'EasyView_Md',
    applicationId: 'EasyViewMd',
    backgroundColor: '#FFFFFF',
    showNameOnTiles: false,
    languages: ['zh-CN', 'en-US'],
    // Electron 37 needs Windows 10 1809+.
    minVersion: '10.0.17763.0',
    maxVersionTested: '10.0.22621.0',
    artifactName: 'EasyView_Md-win-${arch}-store.${ext}',
  },
};
