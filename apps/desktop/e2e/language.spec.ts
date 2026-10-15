import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminateElectron } from './support/electronApp';

const appDir = process.cwd();

function launch(userData: string): Promise<ElectronApplication> {
  const env = { ...process.env };
  delete env.EASYVIEW_DESKTOP_LANGUAGE;
  return electron.launch({ args: [appDir, `--user-data-dir=${userData}`], env });
}

async function menuLabels(application: ElectronApplication): Promise<{ top: string[]; language: Array<{ label: string; checked: boolean }> }> {
  return application.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const ids = ['language-system', 'language-zh-CN', 'language-en'];
    return {
      top: menu?.items.map((item) => item.label) ?? [],
      language: ids.map((id) => {
        const item = menu?.getMenuItemById(id);
        return { label: item?.label ?? '', checked: item?.checked ?? false };
      }),
    };
  });
}

test('desktop language follows the saved preference and the View › Language menu stores a new one', async () => {
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'easyview-desktop-language-')));
  const userData = join(temporaryDirectory, 'user-data');
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, 'preferences.json'), JSON.stringify({ language: 'en' }), 'utf8');

  let application: ElectronApplication | undefined;
  try {
    application = await launch(userData);
    let page = await application.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#desktop-welcome [data-action="open-folder"]')).toContainText('Open Folder');
    await expect.poll(async () => (await menuLabels(application!)).top).toContain('View');
    expect((await menuLabels(application)).language).toEqual([
      { label: 'Follow System', checked: false },
      { label: '简体中文', checked: false },
      { label: 'English', checked: true },
    ]);

    await application.evaluate(({ dialog, Menu }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
      Menu.getApplicationMenu()?.getMenuItemById('language-zh-CN')?.click();
    });
    await expect.poll(async () => JSON.parse(await readFile(join(userData, 'preferences.json'), 'utf8')).language).toBe('zh-CN');
    // Choosing "Later" keeps the running UI in English until the next launch.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await terminateElectron(application);
    application = await launch(userData);
    page = await application.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#desktop-welcome [data-action="open-folder"]')).toContainText('打开文件夹');
    await expect.poll(async () => (await menuLabels(application!)).top).toContain('视图');
    expect((await menuLabels(application)).language.map((item) => item.checked)).toEqual([false, true, false]);
  } finally {
    await terminateElectron(application);
  }
});
