import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';
test('Timeline views and restores versions without changing Git, and releases 100 history views', async () => {
  test.setTimeout(180000);
  const temporary = await mkdtemp(join(tmpdir(),'easyview-timeline-e2e-'));
  const workspace=join(temporary,'workspace'), userData=join(temporary,'user-data'), file=join(workspace,'notes.md');
  await mkdir(workspace,{recursive:true});await mkdir(userData,{recursive:true});
  const git=(...args:string[])=>execFileSync('git',['-C',workspace,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Timeline Runtime');git('config','user.email','timeline@example.test');
  await writeFile(file,'# Notes\n\nOriginal.\n');git('add','.');git('commit','-qm','Initial version');
  await writeFile(file,'# Notes\n\nUpdated.\n');git('add','.');git('commit','-qm','Updated version');
  const index=git('write-tree'), head=git('rev-parse','HEAD');
  await writeFile(join(userData,'desktop-state.json'),JSON.stringify({recentFiles:[file],workspace:{rootPath:workspace,openTabs:[{id:'notes',kind:'editor',filePath:file}],activeTabId:'notes',expandedRelativePaths:[],explorerVisible:true,outlineVisible:true,explorerWidth:380,outlineWidth:280}}));
  const application=await electron.launch({args:[process.cwd(),`--user-data-dir=${userData}`]});
  const errors:string[]=[];
  try {
    const page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await resumeRestoredSession(page);
    await expect(page.locator('.ProseMirror')).toContainText('Updated.');
    const timeline=page.locator('.easyview-timeline');await expect(timeline).toBeVisible();
    await expect(timeline.locator('.easyview-timeline-entry')).toHaveCount(2);
    await page.evaluate(() => { (window as any).easyViewDesktop.timeline.post(null); });
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      (window as any).__historyWorkers = 0;
      window.Worker = class extends NativeWorker {
        private released = false;
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); (window as any).__historyWorkers++; }
        terminate() { if (!this.released) { this.released = true; (window as any).__historyWorkers--; } super.terminate(); }
      };
    });
    const initial=timeline.locator('.easyview-timeline-entry',{hasText:'Initial version'});
    await initial.click();
    await expect(page.locator('.desktop-tab')).toHaveCount(2);
    await expect(page.locator('.easyview-change-view .cm-content')).toContainText('Original.');
    await expect(page.locator('.easyview-change-view .cm-content')).toHaveAttribute('contenteditable','false');
    await expect(page.locator('.easyview-change-hunk-actions')).toHaveCount(0);
    await expect(page.locator('.workspace-header')).toBeInViewport();
    await expect(page.locator('.workspace-entry-name',{hasText:'notes.md'})).toBeInViewport();
    await page.screenshot({ path: '/tmp/easyview-timeline-desktop-preview.png' });
    await expect(timeline.locator('.easyview-timeline-entry')).toHaveCount(2);
    await initial.click();await expect(page.locator('.desktop-tab')).toHaveCount(2);
    await page.locator('.desktop-tab.active .desktop-tab-close').click();await expect(page.locator('.easyview-change-view')).toHaveCount(0);
    const contentBaseline=await page.locator('.cm-editor').count();
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    for(let i=0;i<100;i++){
      await initial.click();try { await expect(page.locator('.easyview-change-view')).toHaveCount(1); } catch (error) { console.log('Timeline cycle',i,'page errors',errors,'body',await page.locator('body').innerText()); throw error; }
      await page.locator('.desktop-tab.active .desktop-tab-close').click();await expect(page.locator('.easyview-change-view')).toHaveCount(0);
    }
    expect(await page.locator('.cm-editor').count()).toBeLessThanOrEqual(contentBaseline);
    await expect(page.locator('.easyview-change-scrollbar')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__historyWorkers)).toBe(0);
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    expect(heapAfter - heapBefore).toBeLessThan(8 * 1024 * 1024);
    const chunks: string[] = [];
    cdp.on('HeapProfiler.addHeapSnapshotChunk', event => chunks.push(event.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    const snapshot = JSON.parse(chunks.join(''));
    const fields: string[] = snapshot.snapshot.meta.node_fields;
    const types: string[] = snapshot.snapshot.meta.node_types[fields.indexOf('type')];
    let retainedHistoryViews = 0;
    for (let offset = 0; offset < snapshot.nodes.length; offset += fields.length) {
      if (types[snapshot.nodes[offset + fields.indexOf('type')]] === 'object' && snapshot.strings[snapshot.nodes[offset + fields.indexOf('name')]] === 'HistoryView') retainedHistoryViews++;
    }
    expect(retainedHistoryViews).toBe(0);
    console.log('History resource check:', { workerCount: 0, retainedHistoryViews, heapGrowthBytes: heapAfter - heapBefore });
    await cdp.detach();
    const before=await timeline.evaluate(el=>el.getBoundingClientRect().height);
    const sash=timeline.locator('.easyview-timeline-sash');const box=await sash.boundingBox();
    await page.mouse.move(box!.x+20,box!.y+2);await page.mouse.down();await page.mouse.move(box!.x+20,box!.y-50);await page.mouse.up();
    expect(await timeline.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(before);
    const chevronBox=await timeline.locator('.easyview-timeline-chevron').boundingBox();const titleBox=await timeline.locator('.easyview-timeline-title').boundingBox();
    expect(Math.abs((chevronBox!.y+chevronBox!.height/2)-(titleBox!.y+titleBox!.height/2))).toBeLessThanOrEqual(1);    for(let i=0;i<100;i++){await timeline.locator('.easyview-timeline-header').click();await expect(timeline.locator('.easyview-timeline-body')).toBeHidden();await timeline.locator('.easyview-timeline-header').click();}
    await expect(initial).toBeVisible();
    await timeline.locator('.easyview-timeline-header').click();
    await timeline.locator('.easyview-timeline-tools button[title="设置"], .easyview-timeline-tools button:has-text("⚙")').first().click();
    const historyDialog = page.locator('.easyview-settings-dialog');
    await expect(historyDialog.locator('.easyview-settings-title')).toHaveText('本地历史设置');
    const historyBox = (await historyDialog.boundingBox())!; const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(Math.abs(historyBox.x + historyBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: 'test-results/timeline-settings-dialog.png' });
    await historyDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('.easyview-settings-overlay')).toHaveCount(0);
    const diagnostics = () => page.evaluate(async () => { const result = await (window as any).easyViewDesktop.timeline.diagnostics(); if (!result.ok) throw new Error(result.message); return result.value; });
    await expect.poll(async () => (await diagnostics()).watchers).toBe(0);
    const idleBefore = await diagnostics();
    await page.waitForTimeout(2000); // Measure absence of polling while idle.
    const idleAfter = await diagnostics();
    expect(idleAfter.queries).toBe(idleBefore.queries);expect(idleAfter.snapshots).toBe(0);expect(idleAfter.requests).toBe(0);expect(idleAfter.queues).toBe(0);expect(idleAfter.pending).toBe(0);
    await timeline.locator('.easyview-timeline-header').click();
    await application.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
    await initial.click({button:'right'});await page.getByRole('menuitem',{name:'恢复此版本'}).click();
    await expect.poll(()=>readFile(file,'utf8')).toContain('Original.');
    await expect(page.locator('.ProseMirror')).toContainText('Original.');
    expect(git('write-tree')).toBe(index);expect(git('rev-parse','HEAD')).toBe(head);
    await expect(timeline.locator('.easyview-timeline-entry',{hasText:'恢复前磁盘内容'})).toBeVisible();
    const localVersion = timeline.locator('.easyview-timeline-entry', { hasText: '恢复前磁盘内容' }).first();
    await localVersion.click();
    await expect(page.locator('.easyview-change-view .cm-content')).toContainText('Original.');
    await expect(page.locator('.easyview-change-deletion-text')).toContainText('Updated.');
    await localVersion.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '恢复此版本' }).click();
    await expect.poll(() => readFile(file,'utf8')).toContain('Updated.');
    expect(git('write-tree')).toBe(index); expect(git('rev-parse','HEAD')).toBe(head);
    const splitIds = await page.evaluate(async () => {
      const api=(window as any).easyViewDesktop;
      const state=await api.tabs.getState(); const original=state.value.activeTabId;
      const split=await api.tabs.executeContextCommand(original,'splitRight');
      if (!split.ok) throw new Error(split.message);
      return { original, copy: split.value.activeTabId };
    });
    await expect(page.locator('.easyview-change-view')).toHaveCount(2);
    await page.evaluate(async (id) => { await (window as any).easyViewDesktop.tabs.close(id); },splitIds.original);
    await expect(page.locator('.easyview-change-view')).toHaveCount(1);
    expect(await page.evaluate(async (id) => (await (window as any).easyViewDesktop.timeline.comparison(id)).ok,splitIds.copy)).toBe(true);
    await page.evaluate(async (id) => { await (window as any).easyViewDesktop.tabs.close(id); },splitIds.copy);
    await expect(page.locator('.easyview-change-view')).toHaveCount(0);
    await expect.poll(async () => (await diagnostics()).snapshots).toBe(0);
    const historyDirectory = join(userData, 'timeline', createHash('sha256').update(await realpath(file)).digest('hex'));
    await mkdir(historyDirectory, { recursive: true });
    await writeFile(join(historyDirectory, 'entries.json'), JSON.stringify({ version: 99 }));
    const renamed = await page.evaluate(async () => {
      try { return await (window as any).easyViewDesktop.document.rename('renamed.md', 'notes'); }
      catch (error) { return { ok: false, message: String(error) }; }
    });
    expect(renamed.ok).toBe(false);
    await expect(page.locator('.desktop-tab-label')).toHaveText('renamed.md');
    expect(await readFile(join(workspace, 'renamed.md'), 'utf8')).toContain('Updated.');
    expect(errors).toEqual([]);
  } finally {await terminateElectron(application);await rm(temporary,{recursive:true,force:true});}
});
