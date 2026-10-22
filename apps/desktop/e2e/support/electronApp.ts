import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { ElectronApplication, Page } from '@playwright/test';

const EXIT_TIMEOUT_MS = 30_000;

/**
 * Force-terminates Electron and waits until Playwright has observed the exit.
 *
 * On Windows Playwright launches Electron through a cmd.exe shell, so
 * `application.process()` is that shell, not Electron. Killing it leaves
 * electron.exe running: the stdio pipes never close, Playwright skips its own
 * taskkill because the shell is already "killed", and `application.close()`
 * then waits forever (test timeout, worker teardown timeout, EBUSY on the
 * profile directory). Kill the real main process tree instead.
 */
export async function terminateElectron(application: ElectronApplication | undefined): Promise<void> {
  if (!application) return;
  const launched = application.process();
  const running = launched.exitCode === null && launched.signalCode === null;
  const pid = running ? await application.evaluate(() => process.pid).catch(() => undefined) : undefined;
  if (pid !== undefined) {
    const closed = once(launched, 'close');
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Electron (pid ${pid}) did not exit within ${EXIT_TIMEOUT_MS}ms`)), EXIT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  await application.close();
}

/**
 * For Electron apps we don't control (VS Code) on local runs. Hidden VS Code windows get re-shown
 * and their webviews stop painting, so windows stay "shown" but fully transparent and click-through,
 * never take focus, and have no Dock icon. CI and EASYVIEW_E2E_HEADED=1 keep normal windows.
 */
export async function keepElectronInBackground(application: ElectronApplication): Promise<void> {
  if (process.env.CI || process.env.EASYVIEW_E2E_HEADED === '1') return;
  // VS Code resets its main-process context right after launch; retry until the patch lands.
  for (let attempt = 1; ; attempt += 1) {
    try { await ghostWindows(application); return; } catch (error) {
      if (attempt >= 20 || !String(error).includes('Execution context was destroyed')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function ghostWindows(application: ElectronApplication): Promise<void> {
  return application.evaluate(({ app, BrowserWindow }) => {
    if (process.platform === 'darwin') app.setActivationPolicy('accessory');
    for (const method of ['focus', 'moveTop'] as const) BrowserWindow.prototype[method] = function noop() {};
    const ghost = (window: Electron.BrowserWindow) => {
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.setSkipTaskbar(true);
    };
    BrowserWindow.getAllWindows().forEach(ghost);
    app.on('browser-window-created', (_event, window) => ghost(window));
  });
}

/** Launch shows the welcome page over restored tabs; enter the restored session like a user would. */
export async function resumeRestoredSession(page: Page): Promise<void> {
  await page.locator('#desktop-welcome [data-action="resume"]').click();
}
