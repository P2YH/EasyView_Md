import { disposeDesktopHistory } from '../../application/document/desktopHistory';
import { app, BrowserWindow, nativeTheme, protocol } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { resolveLocalePreference, setLocale } from '@easyview/contracts';
import { loadLanguagePreference } from '../../application/settings/languageSettings';
import { createAppStateStore } from '../../application/document/appState';
import { createDesktopAiChatHost } from '../../application/ai/createDesktopAiChatHost';
import { initRecentFolderStore } from '../../application/workspace/recentFolders';
import { readDocument, requestOpenDocument, restoreWorkspace } from '../../application/document/documentWorkflow';
import {
  getMainWindow,
  getPendingOpenPath,
  isMarkdownPath,
  previewProtocolSessions,
  sendToWindow,
  setAiChatHost,
  setAppStateStore,
  setPendingOpenPath,
} from '../../application/host/desktopRuntime';
import {
  argvRequestsNewWindow,
  argvRequestsRestart,
  createMenu,
  createNewWindow,
  createWindow,
  findMarkdownArgument,
  restartApp,
} from '../../application/window/windowService';
import { registerDesktopIpc } from './registerDesktopIpc';
import { registerPreviewProtocol, registerPreviewScheme } from './previewProtocol';

if (!squirrelStartup) registerPreviewScheme();

const languagePreference = loadLanguagePreference(app.getPath('userData'));
if (languagePreference !== 'system') app.commandLine.appendSwitch('lang', languagePreference);

const hasSingleInstanceLock = !squirrelStartup && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argvRequestsRestart(argv)) {
      void restartApp();
      return;
    }
    if (argvRequestsNewWindow(argv)) {
      void createNewWindow();
      return;
    }
    const filePath = findMarkdownArgument(argv);
    if (filePath) {
      void requestOpenDocument(filePath).catch((error) => {
        console.error('[EasyView_Md] Failed to open document from second instance:', error);
      });
    }
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!isMarkdownPath(filePath)) return;
    if (!getMainWindow()) {
      setPendingOpenPath(filePath);
      return;
    }
    void requestOpenDocument(filePath).catch((error) => {
      console.error('[EasyView_Md] Failed to open file:', error);
    });
  });

  app.whenReady().then(async () => {
    setLocale(resolveLocalePreference(languagePreference, [...app.getPreferredSystemLanguages(), app.getLocale()]));
    if (!getPendingOpenPath()) setPendingOpenPath(findMarkdownArgument(process.argv));
    const appStateStore = createAppStateStore(app.getPath('userData'), {
      onSaveError: (error) => {
        console.warn('[EasyView_Md] Failed to save app state:', error);
      },
    });
    setAppStateStore(appStateStore);
    await appStateStore.load();
    await initRecentFolderStore(app.getPath('userData')).load();
    setAiChatHost(createDesktopAiChatHost());
    registerPreviewProtocol(protocol, previewProtocolSessions);
    registerDesktopIpc();
    await restoreWorkspace();
    createMenu();
    if (getPendingOpenPath()) {
      const filePath = getPendingOpenPath()!;
      setPendingOpenPath(undefined);
      const result = await readDocument(filePath);
      if (!result.ok) console.error('[EasyView_Md] Failed to open startup file:', result.message);
    }
    createWindow();
    nativeTheme.on('updated', () => {
      sendToWindow(
        'app.themeChanged',
        nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      );
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', disposeDesktopHistory);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
