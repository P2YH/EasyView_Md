import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resumeRestoredSession, terminateElectron } from './electronApp';

export const previewFixtures = path.resolve(process.cwd(), '../../tests/fixtures/preview');

export interface PreviewWorkspace {
  application: ElectronApplication;
  page: Page;
  workspace: string;
  downloads: string;
  open(relativePath: string): Promise<void>;
  dispose(): Promise<void>;
}

/** Launch the real desktop app on a temporary workspace holding the preview fixtures and extra files. */
export async function launchPreviewWorkspace(extra: Record<string, string> = {}, width = 1600): Promise<PreviewWorkspace> {
  const temporary = await mkdtemp(path.join(process.cwd(), '.toolbar-e2e-'));
  const workspace = path.join(temporary, 'workspace'), userData = path.join(temporary, 'user-data'), downloads = path.join(temporary, 'downloads');
  await mkdir(workspace); await mkdir(userData); await mkdir(downloads);
  for (const name of ['sample.csv', 'sample.doc', 'sample.docx', 'sample.html', 'sample.json', 'sample.pdf', 'sample.png', 'sample.pptx', 'sample.svg', 'sample.xlsx', 'sample.zip']) {
    await copyFile(path.join(previewFixtures, name), path.join(workspace, name));
  }
  const markdown = path.join(workspace, 'notes.md');
  await writeFile(markdown, '# Notes\n\nBody text.\n\n## Second\n\nMore.\n');
  for (const [name, content] of Object.entries(extra)) await writeFile(path.join(workspace, name), content);
  await writeFile(path.join(userData, 'desktop-state.json'), JSON.stringify({ recentFiles: [markdown], workspace: { rootPath: workspace, openTabs: [{ id: 'notes', kind: 'editor', filePath: markdown }], activeTabId: 'notes', expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 240 } }));
  const application = await electron.launch({ args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, EASYVIEW_DISABLE_UPDATE_CHECK: '1' } });
  const page = await application.firstWindow();
  await resumeRestoredSession(page);
  // Downloads land in a temp folder instead of a save dialog; print windows are recorded and their
  // print() replaced so the OS dialog never opens in tests.
  await application.evaluate(({ BrowserWindow, session }, { downloads, width }) => {
    session.defaultSession.on('will-download', (_event, item) => { item.setSavePath(`${downloads}/${item.getFilename()}`); });
    const state = globalThis as typeof globalThis & { __easyviewPrintWindows?: number[] };
    state.__easyviewPrintWindows = [];
    const main = BrowserWindow.getAllWindows()[0];
    main.webContents.on('did-create-window', (child) => {
      void child.webContents.executeJavaScript('window.print = () => { document.documentElement.dataset.easyviewPrinted = "1"; }; true').catch(() => undefined);
      const poll = setInterval(() => {
        if (child.isDestroyed()) { clearInterval(poll); return; }
        void child.webContents.executeJavaScript('window.print.toString().includes("easyviewPrinted") || (window.print = () => { document.documentElement.dataset.easyviewPrinted = "1"; }); [document.documentElement.dataset.easyviewPrinted || "", document.body ? document.body.innerText.length + document.images.length : 0]')
          .then(([printed, length]) => { if (printed) { clearInterval(poll); state.__easyviewPrintWindows!.push(Number(length)); child.close(); } })
          .catch(() => undefined);
      }, 50);
    });
    main.setSize(width, 900);
  }, { downloads, width });
  return {
    application, page, workspace, downloads,
    async open(relativePath) {
      await page.evaluate(async (entry) => { await (window as any).easyViewDesktop.tabs.openWorkspaceEntry(entry); }, relativePath);
      const expand = page.getByRole('button', { name: '展开预览工具栏' });
      if (await expand.isVisible().catch(() => false)) await expand.click();
    },
    async dispose() { await terminateElectron(application); await rm(temporary, { recursive: true, force: true }); },
  };
}

/** Print jobs that reached print() in a print window opened by the preview (see launch). */
export const printCount = (application: ElectronApplication) => application.evaluate(() => ((globalThis as typeof globalThis & { __easyviewPrintWindows?: string[] }).__easyviewPrintWindows ?? []).length);

/** Largest rendered content box inside the preview; zoom must grow or shrink it. */
export const contentSize = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('#file-preview-root') ?? document.body;
  let best = 0;
  for (const element of root.querySelectorAll('img, canvas, table, svg:not(.preview-toolbar-icon), [class*="page"], [class*="slide"], .docx-wrapper section')) {
    const rect = element.getBoundingClientRect();
    if (rect.height < 60 || element.closest('[class*="thumb"]:not(.file-viewer-web-shell), [class*="outline"]:not(.file-viewer-web-shell), [class*="lightbox"], nav')) continue;
    best = Math.max(best, Math.round(rect.width));
  }
  return best;
});

export async function expectChanged<T>(read: () => Promise<T>, before: T) {
  await expect.poll(read).not.toEqual(before);
}

/** Colours the per-file theme paints on the preview root and the viewer surface. */
export const paintedBackground = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('#file-preview-root')!;
  const viewer = root.querySelector('.preview-universal-viewer, .preview-basic-viewer') ?? root;
  const r = getComputedStyle(root), v = getComputedStyle(viewer);
  return `${r.backgroundColor}|${r.color}|${v.backgroundColor}|${v.color}`;
});
