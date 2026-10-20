import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostToEditorMessage } from '@easyview/contracts';
import { AiChatHost } from './ai-chat-host';
import { inspectXlsxFile } from './xlsx-edit';

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const chunk = (delta: unknown, finish: string | null = null) => ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });

describe('AiChatHost office (xlsx) agent', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  async function setup(accept: boolean) {
    dir = await mkdtemp(path.join(os.tmpdir(), 'easyview-host-xlsx-'));
    const file = path.join(dir, 'book.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sales').addRows([['Name', 'Qty'], ['Apple', 3]]);
    await workbook.xlsx.writeFile(file);
    const { fingerprint } = await inspectXlsxFile(file);
    const bodies: any[] = [];
    let call = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      call += 1;
      if (call === 1) {
        return sse([chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call1', type: 'function', function: { name: 'apply_sheet_ops', arguments: JSON.stringify({ fingerprint, ops: [{ op: 'setCell', sheet: 'Sales', ref: 'B2', value: 7 }] }) } }] }), chunk({}, 'tool_calls')]);
      }
      return sse([chunk({ role: 'assistant', content: 'B2 已改为 7' }), chunk({}, 'stop')]);
    }) as typeof fetch;
    const posted: HostToEditorMessage[] = [];
    const commits: unknown[] = [];
    let host!: AiChatHost;
    host = new AiChatHost({
      settingsFilePath: path.join(dir, 'settings.json'),
      secretStore: { getApiKey: async () => 'k', setApiKey: async () => undefined, getWebSearchApiKey: async () => null, setWebSearchApiKey: async () => undefined },
      postMessage: (message) => posted.push(message),
      getToolContext: () => ({ workspaceRootPath: dir }),
      fetchImpl,
      officeEdits: {
        showProposal: (_requestId, proposal) => { queueMicrotask(() => host.resolveOfficeEdit(proposal.id, accept)); },
        onCommitted: (_requestId, commit) => { commits.push(commit); },
      },
    });
    await host.handle({ type: 'aiChat.send', requestId: 'r1', mode: 'agent', model: 'm', userMessage: '把 B2 改成 7', attachments: [], history: [], documentFilePath: file, documentFileName: 'book.xlsx' });
    for (let i = 0; i < 200 && !posted.some((m) => m.type === 'aiChat.done' || m.type === 'aiChat.error'); i += 1) await new Promise((r) => setTimeout(r, 10));
    const read = async () => { const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file); return book.getWorksheet('Sales')!.getCell('B2').value; };
    return { host, posted, bodies, commits, read, file };
  }

  it('uses xlsx prompt + tools, writes after Apply, and supports undo', async () => {
    const { host, posted, bodies, commits, read } = await setup(true);
    expect(posted.find((m) => m.type === 'aiChat.error')).toBeUndefined();
    expect(posted.some((m) => m.type === 'aiChat.done')).toBe(true);
    const toolNames = bodies[0].tools.map((t: any) => t.function.name);
    expect(toolNames).toEqual(expect.arrayContaining(['inspect_workbook', 'apply_sheet_ops']));
    expect(toolNames).not.toContain('apply_patch');
    expect(toolNames).not.toContain('create_file');
    expect(bodies[0].messages[0].content).toContain('inspect_workbook');
    expect(await read()).toBe(7);
    expect(commits).toHaveLength(1);
    await host.undoOfficeEdit((commits[0] as { id: string }).id);
    expect(await read()).toBe(3);
  });

  it('leaves the file untouched when the user rejects', async () => {
    const { read, file } = await setup(false);
    const before = await readFile(file);
    expect(await read()).toBe(3);
    expect(Buffer.compare(await readFile(file), before)).toBe(0);
  });
  it('refuses an xlsx path outside the workspace', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'easyview-host-xlsx-'));
    const posted: HostToEditorMessage[] = [];
    const host = new AiChatHost({
      settingsFilePath: path.join(dir, 's.json'),
      secretStore: { getApiKey: async () => 'k', setApiKey: async () => undefined, getWebSearchApiKey: async () => null, setWebSearchApiKey: async () => undefined },
      postMessage: (m) => posted.push(m),
      getToolContext: () => ({ workspaceRootPath: path.join(dir, 'ws') }),
      fetchImpl: (async () => { throw new Error('should not call model'); }) as typeof fetch,
      officeEdits: { showProposal: () => undefined },
    });
    await host.handle({ type: 'aiChat.send', requestId: 'r', mode: 'agent', model: 'm', userMessage: 'x', attachments: [], history: [], documentFilePath: path.join(dir, 'other.xlsx') });
    for (let i = 0; i < 100 && !posted.some((m) => m.type === 'aiChat.error'); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(posted.find((m) => m.type === 'aiChat.error')).toBeDefined();
  });
});
