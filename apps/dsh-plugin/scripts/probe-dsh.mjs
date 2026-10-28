/** E00 smoke against an isolated real DSH profile; never reads the user's profile. */
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

const root = fileURLToPath(new URL('../', import.meta.url));
const installationRoot = process.env.DSH_EASYVIEW_PACKAGE_ROOT ? resolve(process.env.DSH_EASYVIEW_PACKAGE_ROOT) : root;
const runtime = process.env.DSH_TEST_RUNTIME;
if (!runtime) throw new Error('Set DSH_TEST_RUNTIME to the real DSH source checkout');
const home = await mkdtemp(resolve(tmpdir(), 'easyview-dsh-profile-'));
const cli = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts'];
await promisify(execFile)(process.execPath, [...cli, '--profile', 'easyview-test', '--from-default-profile', 'web', '--dump-config'], {
  cwd: runtime, env: { ...process.env, DSH_HOME: home }, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
});
const profile = resolve(home, 'profiles/easyview-test');
const manifestPath = resolve(profile, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies['dsh-plugin-easyview'] = `link:${installationRoot.replaceAll('\\', '/')}`;
manifest.dsh.profile.bundles.push('dsh-plugin-easyview');
await mkdir(resolve(profile, 'node_modules'), { recursive: true });
await symlink(installationRoot, resolve(profile, 'node_modules/dsh-plugin-easyview'), process.platform === 'win32' ? 'junction' : 'dir');
// Production navigation belongs to Office. Exercise the independent public Factory
// through an isolated consumer, never by restoring a production sidebar entry.
const consumerRoot = resolve(home, 'factory-consumer');
await mkdir(consumerRoot, { recursive: true });
await writeFile(resolve(consumerRoot, 'package.json'), JSON.stringify({ name: 'easyview-test-consumer', version: '0.0.0', type: 'module',
  exports: { '.': './index.js', './client': './client.js', './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml' },
  main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'] } } }));
await writeFile(resolve(consumerRoot, 'cordis.patch.yml'), '- insert:\n    - id: easyview-test-consumer\n      name: easyview-test-consumer\n');
await writeFile(resolve(consumerRoot, 'index.js'), 'export function apply() {}\n');
await writeFile(resolve(consumerRoot, 'client.js'), `window.__ModuleLoader__.load({id:'easyview-test-consumer',factory:require=>({inject:['slots','layout'],apply(ctx){
  const {createElement}=require('react');
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'easyview-test'},({renderFactorySlot})=>renderFactorySlot('easyview.workbench',{apiVersion:1,presentation:'embedded'})));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'easyview-test',order:26,label:'EasyView 测试入口'},()=>createElement('span',null,'EV')));
}})});`);
manifest.dependencies['easyview-test-consumer'] = `link:${consumerRoot.replaceAll('\\', '/')}`;
manifest.dsh.profile.bundles.push('easyview-test-consumer');
await symlink(consumerRoot, resolve(profile, 'node_modules/easyview-test-consumer'), process.platform === 'win32' ? 'junction' : 'dir');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const documentsDirectory = resolve(home, 'documents');
const fixtureWorkspace = resolve(documentsDirectory, 'deepseek-harness/default-workspace');
await mkdir(fixtureWorkspace, { recursive: true });
await writeFile(resolve(fixtureWorkspace, 'sample.txt'), 'EasyView DSH authorized text fixture');
await writeFile(resolve(fixtureWorkspace, 'sample.md'), '# EasyView DSH Markdown fixture');
for (const extension of ['docx', 'xlsx']) await copyFile(resolve(root, '../../tests/fixtures/preview', `sample.${extension}`), resolve(fixtureWorkspace, `sample.${extension}`));
for (const extension of ['pdf', 'pptx', 'png']) await copyFile(resolve(root, '../../tests/fixtures/preview', `sample.${extension}`), resolve(fixtureWorkspace, `sample.${extension}`));
const workbook = new ExcelJS.Workbook();
for (const name of ['First', 'Second']) { const sheet = workbook.addWorksheet(name); sheet.getCell('A1').value = `${name} baseline`; sheet.getCell('B2').value = { formula: '1+2', result: 3 }; }
await workbook.xlsx.writeFile(resolve(fixtureWorkspace, 'sample.xlsx'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = Object.fromEntries(await Promise.all(['docx', 'xlsx', 'md', 'txt'].map(async format => [format, hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`)))])));
await mkdir(resolve(root, 'docs/evidence/fixtures'), { recursive: true });
for (const format of ['docx', 'xlsx', 'md', 'txt']) await copyFile(resolve(fixtureWorkspace, `sample.${format}`), resolve(root, `docs/evidence/fixtures/dsh-input.${format}`));
const profilePatch = resolve(profile, 'cordis.patch.yml');
await writeFile(profilePatch, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(documentsDirectory.replaceAll('\\', '/'))}\n`);
const args = [...cli, '--profile', 'easyview-test', '--no-open', '--host', '127.0.0.1', '--port', '0'];
const child = spawn(process.execPath, args, { cwd: runtime, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
let finished = false;
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
const onOutput = chunk => {
  output += chunk;
  const match = output.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/);
  if (match) resolveReady(match[0]);
};
child.stdout.on('data', onOutput);
child.stderr.on('data', onOutput);
child.on('error', rejectReady);
child.on('exit', code => { if (!finished) rejectReady(new Error(`DSH exited before readiness: ${code}`)); });
const timer = setTimeout(() => rejectReady(new Error('DSH readiness timed out after 60s')), 60_000);
let result;
let browser;
let page;
try {
  const launchUrl = await ready;
  const origin = new URL(launchUrl).origin;
  const unauthenticated = await fetch(`${origin}/api/easyview/v1/bootstrap`);
  assert.ok([401, 403].includes(unauthenticated.status), `Unauthenticated request got ${unauthenticated.status}`);
  const exchange = await fetch(launchUrl, { redirect: 'manual' });
  const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie, 'DSH launch-token exchange did not issue a browser session');
  const response = await fetch(`${origin}/api/easyview/v1/bootstrap`, { headers: { cookie } });
  const bootstrap = await response.json();
  assert.equal(response.status, 200, JSON.stringify(bootstrap));
  assert.equal(bootstrap.apiVersion, 1);
  assert.equal(bootstrap.capabilities.save, true);
  assert.ok(bootstrap.frameUrl, 'Original workbench assets are required');
  browser = await chromium.launch({ channel: process.env.EASYVIEW_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blockedExternalRequests = [];
  // Keep the real DSH server available while denying public-network dependencies.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      blockedExternalRequests.push({ origin: url.origin, pathname: url.pathname });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.addCookies(cookie.split('; ').map(value => {
    const index = value.indexOf('=');
    return { name: value.slice(0, index), value: value.slice(index + 1), url: origin };
  }));
  page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const expectedFailureResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() < 400) return;
    const entry = { url: new URL(response.url()).pathname, status: response.status() };
    if (entry.url === '/api/easyview/v1/create-markdown' && entry.status === 409) expectedFailureResponses.push(entry);
    else failedRequests.push(entry);
  });
  await page.goto(`${origin}${bootstrap.frameUrl}`, { waitUntil: 'networkidle' });
  await page.locator('.desktop-welcome-title').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.desktop-welcome-title').textContent(), 'EasyView_Md');
  assert.equal(await page.locator('#ai-chat-toggle').getAttribute('aria-pressed'), 'true', 'AI sidebar opens by default');
  await page.locator('.ai-chat-panel:not(.hidden)').waitFor({ state: 'visible' });
  await page.locator('.ai-chat-input').fill('验证原版 AI 输入界面');
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  const screenshot = resolve(root, 'docs/evidence/e01-original-workbench.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(pageErrors, [], 'Original renderer threw browser errors');
  assert.deepEqual(failedRequests, [], 'Original renderer requested missing assets');
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const previewNotice = page.getByRole('button', { name: '继续', exact: true });
  await previewNotice.waitFor({ state: 'visible', timeout: 15_000 });
  await previewNotice.click();
  await page.getByRole('button', { name: '关闭', exact: true }).click({ timeout: 15_000 });
  await page.getByRole('button', { name: 'EasyView 测试入口', exact: true }).click({ timeout: 30_000 });
  const frame = page.frameLocator('iframe[title="EasyView 文档工作台"]');
  await frame.locator('.desktop-welcome-title').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#ai-chat-toggle').getAttribute('aria-pressed'), 'true', 'AI sidebar opens by default');
  await frame.locator('.ai-chat-panel:not(.hidden)').waitFor({ state: 'visible' });
  await frame.locator('.desktop-welcome-recent-open').first().click();
  await frame.getByRole('button', { name: '新建文件', exact: true }).click();
  const createName = frame.locator('.workspace-create-row input');
  await createName.fill('created-from-tree.md'); await createName.press('Tab');
  await frame.locator('[data-relative-path="created-from-tree.md"] .workspace-entry-name').waitFor();
  await frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror').waitFor();
  assert.equal(await readFile(resolve(fixtureWorkspace, 'created-from-tree.md'), 'utf8'), '');
  const existingCreationStatus = await frame.locator('body').evaluate(async () => {
    const bootstrap = await (await fetch('/api/easyview/v1/bootstrap')).json();
    return (await fetch('/api/easyview/v1/create-markdown', { method: 'POST', body: JSON.stringify({ workspaceId: bootstrap.workspaces[0].id,
      path: 'created-from-tree.md', content: 'must not overwrite', requestId: crypto.randomUUID() }) })).status;
  });
  assert.equal(existingCreationStatus, 409);
  assert.equal(await readFile(resolve(fixtureWorkspace, 'created-from-tree.md'), 'utf8'), '');
  await frame.locator('[data-relative-path="sample.txt"] .workspace-entry-name').click();
  await frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror').getByText('EasyView DSH authorized text fixture', { exact: false }).waitFor({ state: 'visible' });
  await frame.locator('body').evaluate(async () => { const result = await window.easyViewDesktop.tabs.closeAll(); if (!result.ok) throw new Error(result.message); });
  const draftEvidence = [];
  for (const format of ['md', 'txt']) {
    const attached = page.waitForResponse(response => new URL(response.url()).pathname === '/api/easyview/v1/draft-attach');
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    const attachment = (await (await attached).json()).value;
    const prose = frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror');
    await prose.waitFor({ state: 'visible', timeout: 30_000 }); await prose.click();
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(` DSH_DURABLE_${format.toUpperCase()}`);
    await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ state: 'visible', timeout: 30_000 });
    // Flush before a self-owned navigation and validate the bytes independently.
    await frame.locator('[data-relative-path="sample.docx"] .workspace-entry-name').click();
    const recovered = await fetch(`${origin}${attachment.contentUrl}`, { headers: { cookie } });
    const content = await recovered.text(); assert.match(content, new RegExp(`DSH_DURABLE_${format.toUpperCase()}`));
    assert.equal(hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`))), originals[format]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '关闭', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'EasyView 测试入口', exact: true }).click({ timeout: 30_000 });
    await frame.locator('.desktop-welcome-recent-open').first().click();
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    await frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror').getByText(`DSH_DURABLE_${format.toUpperCase()}`, { exact: false }).waitFor({ state: 'visible', timeout: 30_000 });
    await frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror').click();
    await page.keyboard.press('ControlOrMeta+s');
    await frame.locator('[data-easyview-draft-status="saved"]').waitFor({ state: 'visible', timeout: 30_000 });
    assert.match(await readFile(resolve(fixtureWorkspace, `sample.${format}`), 'utf8'), new RegExp(`DSH_DURABLE_${format.toUpperCase()}`));
    draftEvidence.push({ format, originalEditor: true, externalReload: true, originalUnchangedUntilSave: true, originalSaveReadBack: true, independentlyReadBack: true });
  }
  for (const format of ['docx', 'xlsx']) {
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    if (format === 'docx') {
      const paragraph = frame.locator('.paged-editor__pages .layout-paragraph', { hasText: 'DOCX fixture with a table.' }).first();
      await paragraph.waitFor({ timeout: 30_000 }); await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type(' DSH_DURABLE_DOCX');
    } else {
      await frame.locator('.preview-spreadsheet-loading').waitFor({ state: 'detached', timeout: 30_000 });
      await frame.locator('.x-spreadsheet-overlayer').dblclick({ position: { x: 90, y: 35 } });
      await frame.locator('.x-spreadsheet-editor textarea').fill('DSH_FIRST_SHEET');
    }
    await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ state: 'visible', timeout: 30_000 });
    if (format === 'xlsx') {
      await frame.getByRole('tab', { name: 'Second', exact: true }).click();
      await frame.locator('.x-spreadsheet-overlayer').dblclick({ position: { x: 90, y: 35 } });
      await frame.locator('.x-spreadsheet-editor textarea').fill('DSH_SECOND_SHEET');
      await frame.locator('[data-easyview-draft-status="pending"]').waitFor({ state: 'visible' });
      await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ state: 'visible', timeout: 30_000 });
    }
    assert.equal(hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`))), originals[format]);
    // An external reload destroys the entire panel without awaiting an editor flush.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '关闭', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'EasyView 测试入口', exact: true }).click({ timeout: 30_000 });
    await frame.locator('.desktop-welcome-recent-open').first().click();
    const attached = page.waitForResponse(response => new URL(response.url()).pathname === '/api/easyview/v1/draft-attach');
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    const attachment = (await (await attached).json()).value;
    assert.equal(attachment.conflict, false); assert.ok(attachment.record);
    await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ state: 'visible', timeout: 30_000 });
    const recovered = await fetch(`${origin}${attachment.contentUrl}`, { headers: { cookie } });
    assert.equal(recovered.status, 200); const bytes = Buffer.from(await recovered.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    if (format === 'docx') {
      const xml = await zip.file('word/document.xml').async('string'); assert.match(xml, /DSH_DURABLE_DOCX/); assert.match(xml, /<w:tbl[ >]/);
      await frame.locator('.paged-editor__pages .layout-paragraph', { hasText: 'DSH_DURABLE_DOCX' }).first().waitFor();
    } else {
      const strings = await zip.file('xl/sharedStrings.xml').async('string'); assert.match(strings, /DSH_FIRST_SHEET/); assert.match(strings, /DSH_SECOND_SHEET/);
      for (const sheet of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.match(await zip.file(sheet).async('string'), /<f[^>]*>1\+2<\/f>/);
    }
    assert.equal(hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`))), originals[format]);
    await writeFile(resolve(root, `docs/evidence/e03-dsh-recovered.${format}`), bytes);
    await frame.locator('.preview-document-route-save').click();
    await frame.locator('[data-easyview-draft-status="saved"]').waitFor({ state: 'visible', timeout: 30_000 });
    const savedZip = await JSZip.loadAsync(await readFile(resolve(fixtureWorkspace, `sample.${format}`)));
    if (format === 'docx') assert.match(await savedZip.file('word/document.xml').async('string'), /DSH_DURABLE_DOCX/);
    else {
      const strings = await savedZip.file('xl/sharedStrings.xml').async('string'); assert.match(strings, /DSH_FIRST_SHEET/); assert.match(strings, /DSH_SECOND_SHEET/);
      for (const sheet of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.match(await savedZip.file(sheet).async('string'), /<f[^>]*>1\+2<\/f>/);
    }
    await page.screenshot({ path: resolve(root, `docs/evidence/e03-dsh-${format}.png`), fullPage: true });
    draftEvidence.push({ format, externalReload: true, originalUnchangedUntilSave: true, originalSaveReadBack: true, restoredCheckpoint: attachment.record.checkpointRevision, independentlyReadBack: true });
  }
  const modelsResponse = await fetch(`${origin}/api/easyview/v1/models`, { headers: { cookie } });
  const models = await modelsResponse.json();
  assert.equal(modelsResponse.status, 200);
  const modelProbe = { groups: models.value.groups.map(group => ({ id: group.id, modelCount: group.models.length })),
    defaultConfigured: Boolean(models.value.default), availableModelCount: models.value.groups.reduce((total, group) => total + group.models.length, 0),
    failures: models.value.failures.map(failure => failure.id) };
  // Self-owned close can be cancelled or explicitly discard a durable draft.
  await frame.locator('[data-relative-path="sample.md"] .workspace-entry-name').click();
  const activeProse = frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror');
  await activeProse.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' DISCARD_THIS');
  await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ timeout: 30_000 });
  await frame.locator('body').evaluate(() => { window.closeProbe = window.easyViewDesktop.tabs.closeAll(); });
  await frame.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await frame.locator('body').evaluate(() => window.closeProbe)).ok, false);
  assert.match(await activeProse.innerText(), /DISCARD_THIS/);
  await frame.locator('body').evaluate(() => { window.closeProbe = window.easyViewDesktop.tabs.closeAll(); });
  await frame.getByRole('button', { name: '丢弃修改并关闭', exact: true }).click();
  assert.equal((await frame.locator('body').evaluate(() => window.closeProbe)).ok, true);
  await frame.locator('[data-relative-path="sample.md"] .workspace-entry-name').click();
  await activeProse.waitFor({ state: 'visible' }); assert.doesNotMatch(await activeProse.innerText(), /DISCARD_THIS/);
  await activeProse.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' PANEL_SWITCH_RECOVERY');
  await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ timeout: 30_000 });
  const beforePanelSwitch = hash(await readFile(resolve(fixtureWorkspace, 'sample.md')));
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.locator('iframe[title="EasyView 文档工作台"]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'EasyView 测试入口', exact: true }).click();
  await frame.locator('.desktop-welcome-recent-open').first().click();
  await frame.locator('[data-relative-path="sample.md"] .workspace-entry-name').click();
  await activeProse.getByText('PANEL_SWITCH_RECOVERY', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(hash(await readFile(resolve(fixtureWorkspace, 'sample.md'))), beforePanelSwitch);
  const bridge = await page.evaluate(async () => {
    const iframe = document.querySelector('iframe[title="EasyView 文档工作台"]');
    const params = new URL(iframe.src).searchParams;
    const command = name => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID(); const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Bridge timeout')); }, 5000);
      const receive = event => { if (event.source === iframe.contentWindow && event.origin === location.origin && event.data?.requestId === requestId) {
        clearTimeout(timer); window.removeEventListener('message', receive); event.data.ok ? resolve(true) : reject(new Error(event.data.error)); } };
      window.addEventListener('message', receive);
      iframe.contentWindow.postMessage({ protocol: 'easyview.workbench.v1', channel: params.get('channel'), workbenchId: params.get('workbenchId'), requestId, command: name }, location.origin);
    });
    await command('flush'); await command('suspend'); await command('resume'); return true;
  });
  await frame.locator('body').evaluate(() => { window.closeProbe = window.easyViewDesktop.tabs.closeAll(); });
  await frame.getByRole('button', { name: '保存原件并关闭', exact: true }).click();
  assert.equal((await frame.locator('body').evaluate(() => window.closeProbe)).ok, true);
  assert.match(await readFile(resolve(fixtureWorkspace, 'sample.md'), 'utf8'), /PANEL_SWITCH_RECOVERY/);
  const beforeCloseOffice = {};
  for (const format of ['xlsx', 'docx']) {
    beforeCloseOffice[format] = hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`)));
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    if (format === 'xlsx') {
      await frame.locator('.preview-spreadsheet-loading').waitFor({ state: 'detached', timeout: 30_000 });
      await frame.locator('.x-spreadsheet-overlayer').dblclick({ position: { x: 90, y: 35 } });
      await frame.locator('.x-spreadsheet-editor textarea').fill('CLOSE_ALL_XLSX');
    } else {
      const paragraph = frame.locator('.paged-editor__pages .layout-paragraph', { hasText: 'DSH_DURABLE_DOCX' }).first();
      await paragraph.waitFor({ timeout: 30_000 }); await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type(' CLOSE_ALL_DOCX');
    }
    await frame.locator('[data-easyview-draft-status="confirmed"]').waitFor({ timeout: 30_000 });
  }
  await frame.locator('body').evaluate(() => { window.closeProbe = window.easyViewDesktop.tabs.closeAll(); });
  await frame.getByRole('button', { name: '保存原件并关闭', exact: true }).click();
  assert.equal((await frame.locator('body').evaluate(() => window.closeProbe)).ok, true);
  const closeDocx = await JSZip.loadAsync(await readFile(resolve(fixtureWorkspace, 'sample.docx')));
  assert.match(await closeDocx.file('word/document.xml').async('string'), /CLOSE_ALL_DOCX/);
  const closeXlsx = await JSZip.loadAsync(await readFile(resolve(fixtureWorkspace, 'sample.xlsx')));
  assert.match(await closeXlsx.file('xl/sharedStrings.xml').async('string'), /CLOSE_ALL_XLSX/);
  const fileUndo = [];
  for (const format of ['md', 'txt', 'docx', 'xlsx']) {
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    if (format === 'xlsx') await frame.locator('.preview-spreadsheet-loading').waitFor({ state: 'detached', timeout: 30_000 });
    if (format === 'docx') await frame.locator('.paged-editor__pages .layout-paragraph').first().waitFor({ timeout: 30_000 });
    if (['md', 'txt'].includes(format)) await frame.locator('.desktop-editor-session:not([hidden]) .ProseMirror').waitFor();
    await frame.locator('[data-easyview-file-history]').click();
    await frame.locator('[data-easyview-history-dialog] [data-operation-id]').first().getByRole('button', { name: '撤销此次保存' }).click();
    await frame.locator('[data-easyview-history-dialog]').waitFor({ state: 'detached', timeout: 30_000 });
    const expectedHash = format === 'md' ? beforePanelSwitch : format === 'txt' ? originals.txt : beforeCloseOffice[format];
    assert.equal(hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`))), expectedHash, `${format} undo must restore exact prior bytes`);
    if (format === 'xlsx') await frame.locator('.preview-spreadsheet-loading').waitFor({ state: 'detached', timeout: 30_000 });
    if (format === 'docx') await frame.locator('.paged-editor__pages .layout-paragraph').first().waitFor({ timeout: 30_000 });
    fileUndo.push({ format, originalUiHistory: true, inputLease: true, exactBackupRestored: true, editorRemounted: true });
  }
  const previewEvidence = [];
  await frame.locator('body').evaluate(async () => {
    const result = await window.easyViewDesktop.tabs.closeAll();
    if (!result.ok) throw new Error(result.message);
  });
  for (const format of ['pdf', 'pptx', 'png']) {
    const inputHash = hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`)));
    await frame.locator(`[data-relative-path="sample.${format}"] .workspace-entry-name`).click();
    const rendered = format === 'pdf' ? frame.locator('.pdf-content canvas').first()
      : format === 'pptx' ? frame.locator('.pptx-render-surface .slide, .pptx-render-surface .flyfish-pptx-thumbnail').first()
        : frame.locator('.image-frame img').first();
    await rendered.waitFor({ state: 'visible', timeout: 45_000 });
    await rendered.evaluate(async (element, format) => {
      if (format === 'png') {
        await element.decode();
        if (!element.naturalWidth || !element.naturalHeight) throw new Error('Image did not decode');
      } else if (format === 'pdf' && (!element.width || !element.height)) throw new Error('PDF canvas is empty');
    }, format);
    const screenshot = resolve(root, `docs/evidence/e06-${process.env.DSH_EASYVIEW_PACKAGE_ROOT ? 'package-' : ''}preview-${format}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.equal(hash(await readFile(resolve(fixtureWorkspace, `sample.${format}`))), inputHash, `${format} preview changed original`);
    previewEvidence.push({ format, originalViewer: true, rendered: true, originalUnchanged: true, inputHash, screenshot });
  }
  assert.deepEqual(blockedExternalRequests, [], 'A basic document path depends on public-network resources');
  await writeFile(resolve(root, 'docs/evidence/e01-model-environment.json'), JSON.stringify({
    status: modelProbe.availableModelCount > 0 ? 'available-not-tested' : 'blocked',
    reason: modelProbe.availableModelCount > 0 ? 'Real model tool-flow probe still required' : 'The isolated DSH profile exposes no available models and has no copied production credentials',
    ...modelProbe,
  }, null, 2) + '\n');
  const panelScreenshot = resolve(root, 'docs/evidence/e00-dsh-panel.png');
  await page.screenshot({ path: panelScreenshot, fullPage: true });
  assert.deepEqual(pageErrors, [], 'DSH Client or Factory threw browser errors');
  assert.deepEqual(failedRequests, [], 'Unexpected document or asset failures');
  result = { gate: 'E00 real profile probe', status: 'passed', runtime, home,
    command: [process.execPath, ...args], unauthenticatedStatus: unauthenticated.status, authenticatedStatus: response.status, bootstrap,
    installation: process.env.DSH_EASYVIEW_PACKAGE_ROOT ? 'npm-tgz installed in isolated prefix; registered as a bare bundle in temporary DSH profile' : 'isolated link dependency + bare bundle name', installationRoot, fixtureWorkspace, originalInputHashes: originals, modelProbe, draftEvidence,
    creation: { originalFileTree: true, emptyMarkdown: true, exclusiveNoOverwrite: existingCreationStatus === 409 }, fileUndo,
    previews: previewEvidence, resourceNetwork: { publicNetworkDenied: true, blockedExternalRequests, serviceWorkers: 'blocked' },
    lifecycle: { ownCloseCancel: true, explicitDiscard: true, closeAllSavesRemountedOfficeEditors: true, externalPanelUnmountRecovery: true, originalUnchangedOnUnmount: true, publicBridge: bridge },
    browser: { version: browser.version(), originalWelcome: true, originalAiPanel: true, independentFactoryConsumer: true, pageErrors, failedRequests, expectedFailureResponses, screenshot, panelScreenshot } };
} catch (error) {
  await page?.screenshot({ path: resolve(root, 'docs/evidence/e00-failure.png'), fullPage: true });
  result = { gate: 'E00 real profile probe', status: 'failed', runtime, home, error: error.stack,
    log: output.replace(/(token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]') };
  process.exitCode = 1;
} finally {
  finished = true;
  clearTimeout(timer);
  await browser?.close();
  child.kill('SIGINT');
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  await writeFile(resolve(root, `docs/evidence/${process.env.DSH_EASYVIEW_PACKAGE_ROOT ? 'e00-package-probe' : 'e00-profile-probe'}.json`), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
