/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorToHostMessage } from '@easyview/contracts';
import { createAiChatPanel, SETTINGS_SAVE_TIMEOUT_MS } from './AiChatPanel';

describe('AiChatPanel host and document context', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="editor-body"></div><aside id="global-ai-host"></aside>';
    window.localStorage.clear();
  });

  it('mounts in the supplied global host and disables Agent outside Markdown', () => {
    const messages: EditorToHostMessage[] = [];
    const host = document.getElementById('global-ai-host')!;
    const panel = createAiChatPanel({
      container: host,
      postMessage: (message) => messages.push(message),
      getDocumentContent: () => '# Document',
      getFilePath: () => '/workspace/document.md',
      getFileName: () => 'document.md',
      applyDocumentEdit: () => undefined,
      copyText: () => undefined,
    });

    const root = host.querySelector<HTMLElement>('.ai-chat-panel');
    expect(root).not.toBeNull();
    panel.open();
    expect(root?.classList.contains('hidden')).toBe(false);
    expect(messages.some((message) => message.type === 'aiChat.getSettings')).toBe(true);

    panel.setDocumentContextAvailable(false);
    panel.setFilePath('');
    const agent = root?.querySelector<HTMLButtonElement>('[data-mode="agent"]');
    expect(agent?.disabled).toBe(true);
    expect(agent?.title).toContain('仅 Markdown');
    expect(root?.querySelector('[data-mode="chat"]')?.classList.contains('active')).toBe(true);

    panel.setDocumentContextAvailable(true);
    panel.setFilePath('/workspace/document.md');
    expect(agent?.disabled).toBe(false);
    panel.destroy();
    expect(host.querySelector('.ai-chat-panel')).toBeNull();
  });

  it('starts in Agent mode and returns to it once a document is available again', () => {
    const host = document.getElementById('global-ai-host')!;
    const panel = createAiChatPanel({
      container: host,
      postMessage: () => undefined,
      getDocumentContent: () => '# Document',
      getFilePath: () => '/workspace/document.md',
      getFileName: () => 'document.md',
      applyDocumentEdit: () => undefined,
      copyText: () => undefined,
    });
    const active = () => host.querySelector('.ai-chat-mode-btn.active')?.getAttribute('data-mode');
    expect(active()).toBe('agent');
    panel.setDocumentContextAvailable(false);
    expect(active()).toBe('chat');
    panel.setDocumentContextAvailable(true);
    expect(active()).toBe('agent');
    panel.destroy();
  });

  it('picks the mode from a dropdown beside the model, defaulting to Agent over older per-file sessions', () => {
    window.localStorage.setItem('easyview-ai-chat-history:/workspace/document.md', JSON.stringify({ version: 1, mode: 'chat', messages: [] }));
    const host = document.getElementById('global-ai-host')!;
    const create = () => createAiChatPanel({
      container: host,
      postMessage: () => undefined,
      getDocumentContent: () => '# Document',
      getFilePath: () => '/workspace/document.md',
      getFileName: () => 'document.md',
      applyDocumentEdit: () => undefined,
      copyText: () => undefined,
    });
    let panel = create();
    const picker = host.querySelector('.ai-chat-mode-picker')!;
    expect(picker.previousElementSibling?.classList.contains('ai-chat-model-switcher')).toBe(true);
    expect(host.querySelector('.ai-chat-header .ai-chat-mode-btn')).toBeNull();
    expect(host.querySelector('.ai-chat-mode-label')?.textContent).toBe('Agent');

    host.querySelector<HTMLButtonElement>('.ai-chat-mode-current')!.click();
    expect(host.querySelector('.ai-chat-mode-menu')?.classList.contains('open')).toBe(true);
    host.querySelector<HTMLButtonElement>('.ai-chat-mode-option[data-mode="chat"]')!.click();
    expect(host.querySelector('.ai-chat-mode-menu')?.classList.contains('open')).toBe(false);
    expect(host.querySelector('.ai-chat-mode-label')?.textContent).toBe('Chat');
    panel.destroy();

    panel = create();
    expect(host.querySelector('.ai-chat-mode-label')?.textContent).toBe('Chat');
    panel.destroy();
  });

  it('shows all tool calls of a reply on one line above the answer', () => {
    const messages: EditorToHostMessage[] = [];
    const host = document.getElementById('global-ai-host')!;
    const panel = createAiChatPanel({
      container: host,
      postMessage: (message) => messages.push(message),
      getDocumentContent: () => '# Document',
      getFilePath: () => '/workspace/document.md',
      getFileName: () => 'document.md',
      applyDocumentEdit: () => undefined,
      copyText: () => undefined,
    });
    panel.open();
    const settingsRequest = messages.find((message) => message.type === 'aiChat.getSettings') as { requestId: string };
    panel.handleMessage({
      type: 'aiChat.settingsResponse',
      requestId: settingsRequest.requestId,
      settings: { baseUrl: 'https://api.example.com', models: ['m'], defaultModel: 'm' } as never,
      hasApiKey: true,
      hasWebSearchApiKey: false,
    });
    host.querySelector<HTMLTextAreaElement>('.ai-chat-input')!.value = 'check the doc';
    host.querySelector<HTMLButtonElement>('.ai-chat-send-btn')!.click();
    const send = messages.find((message) => message.type === 'aiChat.send') as { requestId: string } | undefined;
    expect(send).toBeDefined();
    const tool = (phase: 'call' | 'result', toolName: string) => panel.handleMessage({ type: 'aiChat.tool', requestId: send!.requestId, phase, toolName, input: {} });
    tool('call', 'list_files');
    tool('result', 'list_files');
    tool('call', 'read_file');
    tool('result', 'read_file');
    tool('call', 'read_file');

    const reply = [...host.querySelectorAll('.ai-chat-msg.assistant')].at(-1)!;
    const line = reply.querySelector('.ai-chat-tool-line')!;
    expect(host.querySelectorAll('.ai-chat-tool-line')).toHaveLength(1);
    expect(line.textContent).toBe('工具调用 3 次：list_files · read_file ×2');
    expect(line.classList.contains('running')).toBe(true);
    expect(line.compareDocumentPosition(reply.querySelector('.ai-chat-bubble')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    tool('result', 'read_file');
    expect(host.querySelector('.ai-chat-tool-line')!.classList.contains('running')).toBe(false);
    panel.destroy();
  });

  describe('settings save', () => {
    afterEach(() => vi.useRealTimers());
    const setup = () => {
      const messages: EditorToHostMessage[] = [];
      const host = document.getElementById('global-ai-host')!;
      const panel = createAiChatPanel({
        container: host, postMessage: (message) => messages.push(message),
        getDocumentContent: () => '', getFilePath: () => '', getFileName: () => '', applyDocumentEdit: () => undefined, copyText: () => undefined,
      });
      const q = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
      q<HTMLTextAreaElement>('.ai-chat-settings-models').value = 'deepseek-chat\ndeepseek-reasoner';
      q<HTMLInputElement>('.ai-chat-settings-temperature').value = '0.7';
      q<HTMLInputElement>('.ai-chat-settings-topp').value = '1';
      q<HTMLInputElement>('.ai-chat-settings-maxtokens').value = '4096';
      q<HTMLInputElement>('.ai-chat-settings-key').value = 'test-key';
      q<HTMLInputElement>('.ai-chat-settings-web-search-key').value = '';
      return { messages, panel, status: () => q<HTMLElement>('.ai-chat-settings-status'), save: q<HTMLButtonElement>('.ai-chat-settings-save') };
    };
    it('waits for settings and key replies, skips an empty optional key, and reports key errors', () => {
      const { messages, panel, status, save } = setup();
      save.click();
      const saves = messages.filter((m) => m.type === 'aiChat.saveSettings' || m.type === 'aiChat.saveApiKey' || m.type === 'aiChat.saveWebSearchApiKey');
      expect(saves.map((m) => m.type)).toEqual(['aiChat.saveSettings', 'aiChat.saveApiKey']);
      expect(status().textContent).toBe('保存中…'); expect(save.disabled).toBe(true);
      const id = (m: EditorToHostMessage) => (m as { requestId: string }).requestId;
      panel.handleMessage({ type: 'aiChat.settingsSaved', requestId: 'someone-else', ok: true });
      panel.handleMessage({ type: 'aiChat.settingsSaved', requestId: id(saves[0]), ok: true });
      expect(status().textContent).toBe('保存中…');
      panel.handleMessage({ type: 'aiChat.settingsSaved', requestId: id(saves[1]), ok: false, message: 'Keychain denied' });
      expect(status().textContent).toBe('Keychain denied'); expect(save.disabled).toBe(false);
      panel.destroy();
    });
    it('times out instead of staying at "Saving…" forever', () => {
      vi.useFakeTimers();
      const { panel, status, save } = setup();
      save.click();
      vi.advanceTimersByTime(SETTINGS_SAVE_TIMEOUT_MS + 1);
      expect(status().textContent).toContain('保存超时');
      expect(status().className).toContain('err'); expect(save.disabled).toBe(false);
      panel.destroy();
    });
  });
});
