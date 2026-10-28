/** Opt-in real-model acceptance against the installed Desktop and its current profile.
 * Uses only synthetic fixtures. API driver acknowledges the same durable draft protocol
 * as the editor; this is Host/model acceptance, not a replacement for original-UI tests.
 */
import { _electron } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { applyAiTextPatches } from '../../../packages/contracts/src/ai/text-patch.ts';
import { hashContent } from '../../../packages/editor-sync/src/contentHash.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.EASYVIEW_DESKTOP_EXE;
const workspace = process.env.EASYVIEW_DESKTOP_WORKSPACE;
if (!executablePath || !workspace) throw new Error('Set EASYVIEW_DESKTOP_EXE and EASYVIEW_DESKTOP_WORKSPACE explicitly; Desktop must be quit before running.');
const suffix = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const folder = `easyview-gpt-test-${suffix}`, fixtureRoot = resolve(workspace, folder);
const evidencePath = resolve(root, 'docs/evidence/e05-desktop-real-ai.json');
const workbenchId = randomUUID(), patchPath = resolve(process.env.USERPROFILE, '.dsh/profiles/desktop/cordis.patch.yml');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalPatchHash = hash(await readFile(patchPath));
await mkdir(fixtureRoot, { recursive: true });
const originalMarkdown = '# 原始标题\n\n保留段落：KEEP_PARAGRAPH_20261028。\n';
await writeFile(resolve(fixtureRoot, 'note.md'), originalMarkdown);
await writeFile(resolve(fixtureRoot, 'empty.md'), '');
const workbook = new ExcelJS.Workbook();
for (const name of ['First', 'Second']) {
  const sheet = workbook.addWorksheet(name); sheet.getCell('A1').value = `${name} original`;
  sheet.getCell('B2').value = { formula: '1+2', result: 3 };
}
await workbook.xlsx.writeFile(resolve(fixtureRoot, 'book.xlsx'));
const originalWorkbook = await readFile(resolve(fixtureRoot, 'book.xlsx'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let application, page;
const runs = [], browserErrors = [];
let result = { status: 'running', kind: 'installed Desktop / real configured model / Host protocol driver',
  originalUiEndToEnd: false, workbenchId, fixtureRoot, runs };
const installedRoot = resolve(process.env.USERPROFILE, '.dsh/profiles/desktop/node_modules/dsh-plugin-easyview');
result.installedRuntime = Object.fromEntries(await Promise.all(['lib/index.js', 'lib/ai-preset.js', 'lib/workbench/asset-manifest.json']
  .map(async path => [path, hash(await readFile(resolve(installedRoot, path)))])));
try {
  application = await _electron.launch({ executablePath, args: [], env, timeout: 90_000 });
  result.application = await application.evaluate(({ app }) => ({ version: app.getVersion(), path: app.getAppPath() }));
  const deadline = Date.now() + 90_000;
  let bootstrap;
  while (Date.now() < deadline) {
    page = application.context().pages().find(candidate => candidate.url().startsWith('dsh-app://app'));
    if (page) {
      bootstrap = await page.evaluate(async () => {
        try { const response = await fetch('/api/easyview/v1/bootstrap'); return response.ok ? await response.json() : null; }
        catch { return null; }
      });
      if (bootstrap?.frameUrl) break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(bootstrap?.frameUrl, 'Installed EasyView Host failed to become ready');
  result.bootstrap = bootstrap;
  page.on('pageerror', error => browserErrors.push(error.message));
  const api = async (name, body, query = {}) => {
    const response = await page.evaluate(async ({ name, body, query }) => {
      const response = await fetch(`/api/easyview/v1/${name}?${new URLSearchParams(query)}`, body === undefined ? {} : {
        method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
      });
      return { status: response.status, data: await response.json() };
    }, { name, body, query });
    if (response.status !== 200 || response.data.ok === false) throw new Error(`${name} HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    return response.data.value ?? response.data;
  };
  const catalog = await api('models');
  assert.ok(catalog.default?.provider && catalog.default?.model, 'Desktop has no configured current model');
  assert.match(catalog.default.model, /gpt/i, 'Current model is not a GPT model');
  const model = `${catalog.default.provider} / ${catalog.default.model}`;
  result.model = catalog.default;
  console.log(`Installed Desktop ${result.application.version}; current model: ${model}`);
  let workspaceId;
  result.workspaceProbes = [];
  for (const candidate of bootstrap.workspaces) {
    const opened = await api('open', undefined, { workspaceId: candidate.id, path: `${folder}/note.md` }).catch(error => {
      result.workspaceProbes.push({ workspaceId: candidate.id, error: error.message }); return null;
    });
    if (opened) { workspaceId = candidate.id; await api('close', [opened.sessionId]); break; }
  }
  assert.ok(workspaceId, 'Fixture path is not in a Desktop-authorized workspace');
  result.workspaceId = workspaceId;
  const open = async name => {
    const descriptor = await api('open', undefined, { workspaceId, path: `${folder}/${name}` });
    const address = { workbenchId, workspaceId, documentId: descriptor.sessionId, generation: randomUUID() };
    const attachment = await api('draft-attach', address);
    return { descriptor, address, attachment, query: { documentId: address.documentId, workbenchId, generation: address.generation } };
  };
  const note = await open('note.md');
  const run = async (document, mode, prompt, decide) => {
    const requestId = randomUUID(), address = document.address;
    const record = { requestId, mode, prompt, status: 'running', patches: 0, proposals: [] };
    runs.push(record); console.log(`Real model request ${runs.length}: ${mode} ${prompt.slice(0, 70)}`);
    await api('ai-send', { address, input: { requestId, mode, model, userMessage: prompt } });
    const delivered = new Set(), expires = Date.now() + 240_000;
    let state;
    try {
      while (Date.now() < expires) {
        state = await api('ai-state', { address });
        for (const event of state.events) if (event.type === 'aiChat.applyPatches' && !delivered.has(event.operationId)) {
          delivered.add(event.operationId);
          const snapshot = await api('text-snapshot', undefined, document.query);
          const next = applyAiTextPatches(snapshot.content, event.patches);
          await api('text-edits', { clientEditId: randomUUID(), baseRevision: snapshot.revision,
            edits: [{ from: 0, to: snapshot.content.length, insert: next }], resultHash: hashContent(next), aiOperationId: event.operationId }, document.query);
          await api('ai-ack', { address, requestId, operationId: event.operationId }); record.patches++;
        }
        for (const message of state.messages.filter(item => item.requestId === requestId)) for (const proposal of message.officeEdits ?? []) {
          if (proposal.status !== 'pending' || delivered.has(proposal.proposalId)) continue;
          assert.equal(typeof decide, 'boolean', 'Unexpected workbook proposal');
          delivered.add(proposal.proposalId);
          assert.deepEqual(await readFile(resolve(fixtureRoot, 'book.xlsx')), originalWorkbook, 'Pending proposal changed original');
          const decision = await api('ai-office-decision', { address, input: { proposalId: proposal.proposalId,
            decisionId: randomUUID(), accepted: decide, editorRevision: 0 } });
          record.proposals.push(decision);
        }
        if (!state.activeRequestId) {
          const messages = state.messages.filter(message => message.requestId === requestId);
          assert.ok(messages.some(message => message.role === 'assistant'), 'No assistant result');
          assert.ok(messages.every(message => !message.error), JSON.stringify(messages));
          record.status = 'passed'; record.messages = messages;
          console.log(`Request ${runs.length}: passed; durable patches=${record.patches}; proposals=${record.proposals.length}`);
          return record;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Real model request timed out after 240s');
    } catch (error) { record.status = 'failed'; record.error = error.message; await api('ai-cancel', { address, requestId }).catch(() => {}); throw error; }
  };
  const edit = await run(note, 'agent', '请先读取当前文档，然后仅把标题“原始标题”替换为“GPT局部修改成功”。必须调用文档修改工具完成，不要改动保留段落，也不要保存原件。');
  assert.ok(edit.patches > 0); let snapshot = await api('text-snapshot', undefined, note.query);
  assert.match(snapshot.content, /GPT局部修改成功/); assert.match(snapshot.content, /KEEP_PARAGRAPH_20261028/);
  assert.equal(await readFile(resolve(fixtureRoot, 'note.md'), 'utf8'), originalMarkdown);
  const beforeChat = snapshot.content;
  const chat = await run(note, 'chat', '请读取当前文档，告诉我标题和保留段落里的英文标记；只读，不做任何修改。');
  assert.equal(chat.patches, 0); assert.equal((await api('text-snapshot', undefined, note.query)).content, beforeChat);
  assert.match(chat.messages.map(message => message.content).join('\n'), /GPT局部修改成功/);
  const continuation = await run(note, 'agent', '请先读取最新版本，然后在文末续写一行“GPT续写成功”，保留现有全部内容。必须使用文档修改工具，不要保存原件。');
  assert.ok(continuation.patches > 0); snapshot = await api('text-snapshot', undefined, note.query);
  assert.match(snapshot.content, /GPT续写成功/); assert.match(snapshot.content, /KEEP_PARAGRAPH_20261028/);
  const createdPath = `${folder}/created-by-gpt.md`;
  await run(note, 'agent', `请调用新建文档工具创建 ${createdPath}，内容为“# GPT新建成功\n\n这是测试文档。”；不要修改当前文档。`);
  assert.match(await readFile(resolve(fixtureRoot, 'created-by-gpt.md'), 'utf8'), /GPT新建成功/);
  const empty = await open('empty.md');
  const drafting = await run(empty, 'agent', '请先读取空文档，然后用文档修改工具写入“# GPT空文档起草成功\n\n用于验收。”，不要保存原件。');
  assert.ok(drafting.patches > 0); assert.match((await api('text-snapshot', undefined, empty.query)).content, /GPT空文档起草成功/);
  assert.equal(await readFile(resolve(fixtureRoot, 'empty.md'), 'utf8'), '');
  const book = await open('book.xlsx');
  const workbookPrompt = '请先读取当前工作簿，用修改工具提出提案：仅把 First 工作表 A1 单元格的值改为 GPT_XLSX_OK，不修改其它单元格和公式，等待用户决定。';
  const rejected = await run(book, 'agent', workbookPrompt, false);
  assert.ok(rejected.proposals.some(proposal => proposal.state === 'rejected'));
  assert.deepEqual(await readFile(resolve(fixtureRoot, 'book.xlsx')), originalWorkbook);
  const accepted = await run(book, 'agent', workbookPrompt + '这是一次新的修改请求，请重新生成提案。', true);
  const commit = accepted.proposals.find(proposal => proposal.state === 'committed'); assert.ok(commit?.operationId);
  const actual = new ExcelJS.Workbook(); await actual.xlsx.readFile(resolve(fixtureRoot, 'book.xlsx'));
  assert.equal(actual.getWorksheet('First').getCell('A1').value, 'GPT_XLSX_OK');
  for (const name of ['First', 'Second']) assert.equal(actual.getWorksheet(name).getCell('B2').value.formula, '1+2');
  await api('undo', { requestId: randomUUID(), operationId: commit.operationId, editorRevision: 0 }, book.query);
  assert.deepEqual(await readFile(resolve(fixtureRoot, 'book.xlsx')), originalWorkbook);
  const restored = await api('ai-state', { address: book.address });
  assert.ok(restored.messages.some(message => message.officeEdits?.some(proposal => proposal.status === 'undone')));
  assert.deepEqual((await api('models')).default, catalog.default, 'Global default model changed');
  assert.equal(hash(await readFile(patchPath)), originalPatchHash, 'User configuration patch changed');
  await api('close', [note.address.documentId, empty.address.documentId, book.address.documentId]);
  result = { ...result, status: 'passed', cases: { markdownLocalPatch: true, chatReadOnly: true, modeSwitch: true,
    continuation: true, createMarkdown: true, emptyDraft: true, xlsxReject: true, xlsxApply: true,
    formulaRetained: true, exactFileUndo: true, proposalStateRestored: true, originalsPreservedUntilExplicitCommit: true },
    globalModelUnchanged: true, userPatchUnchanged: true, browserErrors };
} catch (error) {
  result = { ...result, status: 'failed', error: error.stack, browserErrors };
  await page?.screenshot({ path: resolve(root, 'docs/evidence/e05-desktop-real-ai-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
  await application?.close();
  console.log(JSON.stringify({ status: result.status, application: result.application, model: result.model,
    requests: runs.length, error: result.error, evidencePath }, null, 2));
}
