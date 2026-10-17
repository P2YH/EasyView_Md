import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToEditorMessage } from '@easyview/contracts';
import type { OpenAiChatRequestOptions } from '../src/ai/openai-chat-client';
const mocked = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../src/ai/openai-chat-client', async importOriginal => ({ ...await importOriginal<typeof import('../src/ai/openai-chat-client')>(), streamOpenAiChat: mocked.stream }));
import { AiChatHost } from '../src/ai/ai-chat-host';

describe('AI tool edit confirmation', () => {
  let root = '';
  let host: AiChatHost | undefined;
  afterEach(async () => { host?.dispose(); if (root) await rm(root, { recursive: true, force: true }); });
  async function start() {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'easyview-ai-edit-')));
    const posted: HostToEditorMessage[] = [];
    host = new AiChatHost({ settingsFilePath: path.join(root, 'settings.json'), postMessage: message => posted.push(message), getToolContext: () => ({ workspaceRootPath: root }), secretStore: { getApiKey: async () => 'test', setApiKey: async () => {}, getWebSearchApiKey: async () => null, setWebSearchApiKey: async () => {} } });
    mocked.stream.mockImplementation(async (options: OpenAiChatRequestOptions) => {
      const tools = options.tools as unknown as Record<string, { execute(input: unknown, context: unknown): Promise<unknown> }>;
      const baseline = await tools.inspect_file.execute({}, {} as never) as { baselineId: string };
      await tools.apply_patch.execute({ baselineId: baseline.baselineId, patches: [{ description: 'edit', expectedText: 'original', replacement: 'changed' }] }, {} as never);
      return { content: 'Applied', finishReason: 'stop' };
    });
    await host.handle({ type: 'aiChat.send', requestId: 'edit', mode: 'agent', model: 'test', userMessage: 'edit', history: [], attachments: [], documentFilePath: path.join(root, 'notes.md'), documentContent: 'original' });
    await vi.waitFor(() => expect(posted.some(message => message.type === 'aiChat.applyPatches')).toBe(true));
    const patch = posted.find(message => message.type === 'aiChat.applyPatches') as Extract<HostToEditorMessage, { type: 'aiChat.applyPatches' }>;
    return { posted, patch };
  }
  it('cannot finish successfully until the editor has accepted the patch', async () => {
    const { posted, patch } = await start();
    expect(posted.some(message => message.type === 'aiChat.done')).toBe(false);
    await host!.handle({ type: 'aiChat.patchesApplied', requestId: 'edit', operationId: patch.operationId });
    await vi.waitFor(() => expect(posted.some(message => message.type === 'aiChat.done')).toBe(true));
  });
  it('propagates an editor conflict to the request instead of claiming success', async () => {
    const { posted, patch } = await start();
    await host!.handle({ type: 'aiChat.patchesApplied', requestId: 'edit', operationId: patch.operationId, error: 'Document changed' });
    await vi.waitFor(() => expect(posted).toContainEqual({ type: 'aiChat.error', requestId: 'edit', message: 'Document changed' }));
    expect(posted.some(message => message.type === 'aiChat.done')).toBe(false);
  });
});
