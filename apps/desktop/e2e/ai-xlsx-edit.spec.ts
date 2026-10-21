import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { resumeRestoredSession, terminateElectron } from './support/electronApp';

const fingerprint = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** OpenAI-compatible mock: first turn asks to set Sales!B2=7, the turn after a tool result replies with text. */
function startMockModel(xlsx: string): Promise<Server> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (part) => { body += part; });
    request.on('end', async () => {
      const payload = JSON.parse(body) as { messages: Array<{ role: string }> };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (payload.messages.some((message) => message.role === 'tool')) {
        response.end(chunk({ role: 'assistant', content: '已处理' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
        return;
      }
      const args = JSON.stringify({ fingerprint: fingerprint(await readFile(xlsx)), ops: [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 7 }] });
      response.end(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${Date.now()}`, type: 'function', function: { name: 'apply_sheet_ops', arguments: args } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function writeBook(xlsx: string, qty: number) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Sales').addRows([['Name', 'Qty'], ['Apple', qty]]);
  await book.xlsx.writeFile(xlsx);
}
async function cellB2(xlsx: string) {
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(xlsx);
  return book.getWorksheet('Sales')!.getCell('B2').value;
}

test('Agent edits an xlsx preview only after Apply, can undo, and refuses an externally modified file', async () => {
  const temporary = await mkdtemp(path.join(process.cwd(), '.ai-xlsx-e2e-'));
  const workspace = path.join(temporary, 'workspace'); const userData = path.join(temporary, 'user-data');
  await mkdir(workspace); await mkdir(userData);
  const xlsx = path.join(workspace, 'book.xlsx'); await writeBook(xlsx, 3);
  const markdown = path.join(workspace, 'notes.md'); await writeFile(markdown, '# Notes\n');
  const server = await startMockModel(xlsx);
  const port = (server.address() as AddressInfo).port;
  await writeFile(path.join(userData, 'ai-chat-settings.json'), JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, models: ['mock'], defaultModel: 'mock', temperature: 1, topP: 1, maxTokens: 512, systemPrompt: '', stream: true }));
  await writeFile(path.join(userData, 'desktop-state.json'), JSON.stringify({ recentFiles: [markdown], workspace: { rootPath: workspace, openTabs: [{ id: 'notes', kind: 'editor', filePath: markdown }], activeTabId: 'notes', expandedRelativePaths: [], explorerVisible: true, outlineVisible: false, explorerWidth: 240, outlineWidth: 240 } }));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, EASYVIEW_DISABLE_UPDATE_CHECK: '1' } });
    const encrypted = await application.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString('mock-key').toString('base64') : '');
    test.skip(!encrypted, 'safeStorage unavailable on this machine');
    await writeFile(path.join(userData, 'ai-chat-api-key.bin'), Buffer.from(encrypted, 'base64'));
    const page = await application.firstWindow(); await resumeRestoredSession(page);
    await page.evaluate(async () => { await (window as any).easyViewDesktop.tabs.openWorkspaceEntry('book.xlsx'); });
    await expect(page.locator('.x-spreadsheet-overlayer')).toBeVisible();
    await page.locator('#ai-chat-toggle').click();
    const panel = page.locator('#desktop-ai-chat-host .ai-chat-panel:not(.hidden):not(.suspended)');
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('[data-mode="agent"]')).toBeEnabled();
    await panel.locator('.ai-chat-mode-current').click();
    await panel.locator('.ai-chat-mode-btn[data-mode="agent"]').click();
    await expect(panel.locator('.ai-chat-mode-label')).toHaveText('Agent');

    const ask = async () => {
      await panel.locator('.ai-chat-input').fill('把 B2 改成 7');
      await panel.locator('.ai-chat-send-btn').click();
    };

    // 1) Proposal → nothing written → Apply → written + backup → Undo restores.
    await ask();
    const edit = panel.locator('.ai-chat-office-edit').last();
    await expect(edit.locator('td.after')).toHaveText('7');
    await expect(edit.locator('td.before')).toHaveText('3');
    expect(await cellB2(xlsx)).toBe(3);
    await edit.locator('.ai-chat-office-btn.apply').click();
    await expect.poll(() => cellB2(xlsx)).toBe(7);
    await expect(edit).toHaveClass(/\bapplied\b/);
    // The workspace sits in an ignored folder, so the pre-edit copy goes to app data, never into the workspace.
    expect((await readdir(path.join(userData, 'ai-backups'))).length).toBe(1);
    expect(await readdir(workspace)).not.toContain('.easyview');
    await edit.locator('.ai-chat-office-btn.undo').click();
    await expect.poll(() => cellB2(xlsx)).toBe(3);
    await expect(edit).toHaveClass(/\bundone\b/);
    // The preview reloads from disk after the write and the undo.
    await expect(page.locator('.x-spreadsheet-overlayer')).toBeVisible();

    // 2) File changed externally while the proposal waits → Apply is refused, external content kept.
    await ask();
    const second = panel.locator('.ai-chat-office-edit').last();
    await expect(second.locator('.ai-chat-office-btn.apply')).toBeVisible();
    await writeBook(xlsx, 100);
    await second.locator('.ai-chat-office-btn.apply').click();
    await expect(second).toHaveClass(/\berror\b/);
    expect(await cellB2(xlsx)).toBe(100);
    await expect(page.locator('.x-spreadsheet-overlayer')).toBeVisible();
    await page.screenshot({ path: path.join(process.cwd(), 'test-results', 'ai-xlsx-edit.png') });
  } finally {
    if (application) await terminateElectron(application);
    server.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
