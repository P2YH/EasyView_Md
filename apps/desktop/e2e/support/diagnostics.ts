import type { ElectronApplication, Page } from '@playwright/test';

/** Temporary CI diagnostics: logs main-process window state while waiting for the first window. */
export async function firstWindowWithDiagnostics(application: ElectronApplication, label: string): Promise<Page> {
  const started = Date.now();
  const log = (...parts: unknown[]) => console.log(`[diag ${label} +${Date.now() - started}ms]`, ...parts);
  application.process().stdout?.on('data', (chunk) => log('main stdout', String(chunk).trim()));
  application.process().stderr?.on('data', (chunk) => log('main stderr', String(chunk).trim()));
  application.on('window', (page) => log('window event', page.url()));
  let probing = false;
  const timer = setInterval(() => {
    if (probing) { log('previous main-process probe still pending (main process blocked?)'); return; }
    probing = true;
    void application.evaluate(({ BrowserWindow, app }) => ({
      ready: app.isReady(),
      windows: BrowserWindow.getAllWindows().map((window) => ({
        id: window.id,
        url: window.webContents.getURL(),
        visible: window.isVisible(),
        loading: window.webContents.isLoading(),
        crashed: window.webContents.isCrashed(),
      })),
    })).then((state) => log('main state', JSON.stringify(state), 'pw windows', application.windows().length))
      .catch((error) => log('probe failed', String(error)))
      .finally(() => { probing = false; });
  }, 5_000);
  try {
    const page = await application.firstWindow();
    log('firstWindow resolved', page.url());
    page.on('console', (message) => log('renderer console', message.type(), message.text()));
    page.on('pageerror', (error) => log('renderer pageerror', String(error)));
    return page;
  } finally {
    clearInterval(timer);
  }
}
