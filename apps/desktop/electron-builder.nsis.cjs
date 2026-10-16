/**
 * electron-builder config for the website Windows installer (NSIS wizard).
 *
 * Re-packages the Forge output (out/EasyView_Md-win32-x64, passed as `prepackaged`) via
 * scripts/make-nsis.mjs, so the app binaries are identical to the zip and Store builds.
 * The wizard offers "only for me" (HKCU, no admin) or "for all users" (HKLM, elevated)
 * plus a custom install directory.
 *
 * File associations are written by build/installer.nsh instead of `fileAssociations`:
 * electron-builder's association would take over the default .md handler, while EasyView_Md
 * only adds itself to Explorer's "Open with" list.
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
  directories: {
    buildResources: 'build',
    output: 'out/nsis',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // The prepackaged Forge executable already carries its version resources; never re-edit it.
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'EasyView_Md',
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerLanguages: ['zh_CN', 'en_US'],
    deleteAppDataOnUninstall: false,
    include: 'build/installer.nsh',
    artifactName: 'EasyView_Md-win-${arch}-setup.${ext}',
  },
};
