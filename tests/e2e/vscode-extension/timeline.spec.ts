import { _electron as electron, expect, test, type Frame } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { terminateElectron } from '../../../apps/desktop/e2e/support/electronApp';
test('VS Code development extension opens Timeline versions in a read-only Change tab', async()=>{
  test.setTimeout(120000);
  const temporary=await mkdtemp(join(tmpdir(),'easyview-timeline-vscode-')),workspace=join(temporary,'workspace');await mkdir(workspace);
  await mkdir(join(temporary,'data','User'),{recursive:true});
  await writeFile(join(temporary,'data','User','settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','window.dialogStyle':'custom','easyviewMd.workspace.focusFilesOnStartup':true}));
  const git=(...args:string[])=>execFileSync('git',['-C',workspace,...args]);git('init','-q');git('config','user.name','Timeline Test');git('config','user.email','timeline@example.test');
  await writeFile(join(workspace,'notes.md'),'# Original\n');git('add','.');git('commit','-qm','Initial version');await writeFile(join(workspace,'notes.md'),'# Updated\n');git('add','.');git('commit','-qm','Updated version');
  const executablePath = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('Set VSCODE_EXECUTABLE_PATH to the VS Code executable before running this test');
  const application=await electron.launch({executablePath,args:[`--user-data-dir=${join(temporary,'data')}`,`--extensions-dir=${join(temporary,'extensions')}`,`--extensionDevelopmentPath=${resolve(__dirname,'../../../apps/vscode-extension')}`,'--disable-workspace-trust','--skip-welcome','--skip-release-notes',workspace],timeout:60000});
  try{
    const page=await application.firstWindow();
    let sidebar:Frame|undefined;
    await expect.poll(async()=>{
      for(const frame of page.frames()) if(await frame.locator('.easyview-timeline').count()) {sidebar=frame;return true;}
      return false;
    },{timeout:60000}).toBe(true);
    await sidebar!.locator('.workspace-entry-name',{hasText:'notes.md'}).click();
    await expect(sidebar!.locator('.easyview-timeline-entry')).toHaveCount(2);
    await expect(sidebar!.locator('.easyview-timeline-header')).toHaveText('⌄  TIMELINE');
    const filter = sidebar!.getByRole('button', { name: 'Filter Sources', exact: true });
    await filter.click();
    const sourceOptions = sidebar!.getByRole('menuitemcheckbox');
    await expect(sourceOptions).toHaveCount(4);
    for (const option of await sourceOptions.all()) await expect(option).toHaveAttribute('aria-checked', 'true');
    await sidebar!.getByRole('menuitemcheckbox', { name: 'Git History', exact: true }).click();
    await expect(sidebar!.locator('.easyview-timeline-entry')).toHaveCount(0);
    await sidebar!.getByRole('menuitemcheckbox', { name: 'Git History', exact: true }).click();
    await expect(sidebar!.locator('.easyview-timeline-entry')).toHaveCount(2);
    await filter.click();
    await expect(sidebar!.locator('.easyview-timeline-filter-menu')).toHaveCount(0);

    await sidebar!.locator('.easyview-timeline-entry',{hasText:'Initial version'}).click();
    let history:Frame|undefined;
    await expect.poll(async()=>{for(const frame of page.frames())if(await frame.locator('.easyview-history-view').count()){history=frame;return true;}return false;},{timeout:30000}).toBe(true);
    await expect(history!.locator('.easyview-change-view .cm-content')).toContainText('Original');
    await expect(history!.locator('.easyview-change-view .cm-content')).toHaveAttribute('contenteditable','false');
    await expect(history!.locator('.easyview-change-hunk-actions')).toHaveCount(0);
    const selectedVersion = sidebar!.locator('.easyview-timeline-entry', { hasText: 'Initial version' });
    await page.mouse.move(0, 0);
    await expect(selectedVersion).toHaveAttribute('aria-pressed', 'true');
    const selectionFill = await selectedVersion.evaluate(row => getComputedStyle(row).backgroundColor);
    expect(selectionFill).not.toBe('rgba(0, 0, 0, 0)');
    await sidebar!.getByRole('button', { name: 'Refresh Timeline', exact: true }).click();
    await expect(selectedVersion).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    expect(await selectedVersion.evaluate(row => getComputedStyle(row).backgroundColor)).toBe(selectionFill);

    await page.screenshot({ path: '/tmp/easyview-timeline-vscode-preview.png' });
    await expect(sidebar!.locator('.easyview-timeline-entry')).toHaveCount(2);
    await sidebar!.locator('.easyview-timeline-entry',{hasText:'Initial version'}).click({button:'right'});
    const timelineMenuStyle = await sidebar!.locator('.easyview-timeline-menu').evaluate(menu => {
      const css=getComputedStyle(menu), item=getComputedStyle(menu.querySelector('button')!);
      return [css.fontSize,css.borderRadius,css.padding,css.boxShadow,item.fontSize,item.padding,item.minHeight];
    });
    await sidebar!.getByRole('menuitem',{name:'Restore This Version'}).click();
    await page.getByRole('button',{name:'恢复',exact:true}).click();
    await expect.poll(()=>readFile(join(workspace,'notes.md'),'utf8')).toBe('# Original\n');
    await expect(sidebar!.locator('.easyview-timeline-entry',{hasText:'恢复前磁盘内容'})).toBeVisible();
    await sidebar!.locator('.workspace-entry-name',{hasText:'notes.md'}).click({button:'right'});
    const treeMenuStyle = await sidebar!.locator('.workspace-file-context-menu').evaluate(menu => {
      const css=getComputedStyle(menu), item=getComputedStyle(menu.querySelector('button')!);
      return [css.fontSize,css.borderRadius,css.padding,css.boxShadow,item.fontSize,item.padding,item.minHeight];
    });
    expect(timelineMenuStyle).toEqual(treeMenuStyle);
  }finally{await terminateElectron(application);await rm(temporary,{recursive:true,force:true});}
});
