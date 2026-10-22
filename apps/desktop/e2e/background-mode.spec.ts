import { expect, test } from '@playwright/test';
import { launchPreviewWorkspace } from './support/previewWorkspace';

/** Local runs (EASYVIEW_E2E_BACKGROUND=1, see playwright.config.ts) must never show a window, take focus or add a Dock icon. */
test('background test runs keep EasyView windowless and unfocused', async () => {
  test.skip(process.env.EASYVIEW_E2E_BACKGROUND !== '1', 'only meaningful in background mode');
  const ws = await launchPreviewWorkspace();
  try {
    await ws.open('sample.pdf');
    await expect(ws.page.locator('#file-preview-root')).toBeVisible();
    // The print button opens a child window; it must stay hidden too.
    await ws.page.locator('#file-preview-root').getByRole('button', { name: '打印完整渲染内容', exact: true }).first().click();
    await ws.page.getByText('直接打印', { exact: true }).click();
    const state = await ws.application.evaluate(({ app, BrowserWindow }) => ({
      visible: BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
      focused: BrowserWindow.getFocusedWindow() !== null,
      dock: process.platform === 'darwin' ? app.dock?.isVisible() ?? false : false,
    }));
    expect(state).toEqual({ visible: 0, focused: false, dock: false });
  } finally { await ws.dispose(); }
});
