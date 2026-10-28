/** Real browser/engine round-trips; outputs are read independently as OOXML below. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cssInjectPlugin } from '../../../packages/preview-ui/esbuild-css-inject.mjs';
import { spreadsheetLifecyclePlugin } from '../../../packages/preview-ui/esbuild-spreadsheet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = resolve(root, '../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'easyview-viewers-'));
const evidence = resolve(root, 'docs/evidence');
await mkdir(evidence, { recursive: true });
await build({ entryPoints: [resolve(root, 'tests/browser/viewer-probe.ts')], outfile: resolve(temporary, 'probe.js'), bundle: true,
  platform: 'browser', format: 'esm', target: 'chrome128', plugins: [spreadsheetLifecyclePlugin(), cssInjectPlugin()],
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl' } });
const workbook = new ExcelJS.Workbook();
for (const name of ['First', 'Second']) {
  const sheet = workbook.addWorksheet(name);
  sheet.getCell('A1').value = `${name} baseline`;
  sheet.getCell('B2').value = { formula: '1+2', result: 3 };
  sheet.getCell('C3').value = 'Untouched'; sheet.getCell('C3').font = { bold: true };
}
const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
const docx = await readFile(resolve(workspace, 'tests/fixtures/preview/sample.docx'));
const samples = { docx, xlsx };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><link rel="stylesheet" href="/assets/preview.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>'); return; }
    let bytes;
    if (path === '/probe.js') bytes = await readFile(resolve(temporary, 'probe.js'));
    else if (path === '/fixture.docx') bytes = docx;
    else if (path === '/fixture.xlsx') bytes = xlsx;
    else if (path.startsWith('/assets/') && !path.includes('..')) bytes = await readFile(resolve(root, 'lib/workbench', path.slice(8)));
    else { response.writeHead(404).end(); return; }
    response.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(path)] || 'application/octet-stream');
    response.end(bytes);
  } catch (error) { response.writeHead(500).end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.EASYVIEW_BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const results = [];
try {
  for (const format of ['docx', 'xlsx']) {
    await page.goto(`${origin}/?format=${format}`);
    if (format === 'docx') {
      const paragraph = page.locator('.paged-editor__pages .layout-paragraph', { hasText: 'DOCX fixture with a table.' }).first();
      await paragraph.waitFor({ timeout: 30_000 });
      await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type(' CHECKPOINT_ONE');
    } else {
      await page.locator('.preview-spreadsheet-loading').waitFor({ state: 'detached', timeout: 30_000 });
      await page.locator('.x-spreadsheet-overlayer').dblclick({ position: { x: 90, y: 35 } });
      await page.locator('.x-spreadsheet-editor textarea').fill('FIRST_EDIT');
      // Capture with the cell still open, without Enter/blur.
    }
    const captured = await page.evaluate(() => window.probe.capture());
    assert.equal((await page.evaluate(() => window.probe.writes.length)), 0, 'Checkpoint must not save the original');
    assert.equal((await page.evaluate(() => window.probe.state())).dirty, true);
    const output = Buffer.from(captured.bytes, 'base64');
    await writeFile(resolve(evidence, `e01-${format}-checkpoint.${format}`), output);
    const zip = await JSZip.loadAsync(output);
    if (format === 'docx') {
      const xml = await zip.file('word/document.xml').async('string');
      assert.match(xml, /CHECKPOINT_ONE/); assert.match(xml, /<w:tbl[ >]/);
    } else {
      // Independent XML read-back (the UI bridge cannot satisfy these assertions).
      const strings = await zip.file('xl/sharedStrings.xml').async('string');
      assert.match(strings, /FIRST_EDIT/);
      for (const sheet of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.match(await zip.file(sheet).async('string'), /<f[^>]*>1\+2<\/f>/);
      await page.getByRole('tab', { name: 'Second', exact: true }).click();
      await page.locator('.x-spreadsheet-overlayer').dblclick({ position: { x: 90, y: 35 } });
      await page.locator('.x-spreadsheet-editor textarea').fill('SECOND_EDIT');
      const both = await page.evaluate(() => window.probe.capture());
      const bothZip = await JSZip.loadAsync(Buffer.from(both.bytes, 'base64'));
      const bothStrings = await bothZip.file('xl/sharedStrings.xml').async('string');
      assert.match(bothStrings, /FIRST_EDIT/); assert.match(bothStrings, /SECOND_EDIT/);
      await writeFile(resolve(evidence, 'e01-xlsx-all-sheets.xlsx'), Buffer.from(both.bytes, 'base64'));
    }
    // Save errors retain dirty; restoration changes only the live editor.
    await page.evaluate(() => window.probe.failWrites(true));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.preview-document-route-save')?.getAttribute('title') === 'injected_write_failure');
    assert.equal((await page.evaluate(() => window.probe.state())).dirty, true);
    await page.evaluate(() => window.probe.restore());
    const restored = await page.evaluate(() => window.probe.capture());
    assert.equal(await page.evaluate(() => window.probe.writes.length), 0);
    assert.ok(restored.editorRevision >= captured.editorRevision);
    await page.screenshot({ path: resolve(evidence, `e01-${format}-viewer.png`), fullPage: true });
    results.push({ format, status: 'passed', inputHash: createHash('sha256').update(samples[format]).digest('hex'),
      checkpointHash: createHash('sha256').update(output).digest('hex'), revision: captured.editorRevision, originalWrites: 0 });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(evidence, 'e01-viewers.json'), JSON.stringify({ status: 'passed', cases: results, browser: browser.version(), errors }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', cases: results, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(evidence, 'e01-viewer-failure.png'), fullPage: true });
  await writeFile(resolve(evidence, 'e01-viewers.json'), JSON.stringify({ status: 'failed', cases: results, error: error.message, errors }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
