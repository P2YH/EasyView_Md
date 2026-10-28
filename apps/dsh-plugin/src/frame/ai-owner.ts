/** Adapt original aiChat messages; model credentials and history never enter this frame. */
import { DEFAULT_AI_CHAT_SETTINGS, type EditorToHostMessage, type HostToEditorMessage } from '@easyview/contracts';
import type { AiAddress, VisibleAiMessage } from '../shared/ai';
interface State {
  messages: VisibleAiMessage[]; activeRequestId?: string; streamingMessageId?: string;
  content: string; events: HostToEditorMessage[];
}
export function createAiOwner(options: {
  address(path?: string): AiAddress;
  filePath(): string;
  filesChanged(): void;
  emit(message: HostToEditorMessage): void;
  flush(): Promise<void>;
  prepareContext(path?: string): Promise<void>;
  officeLease<T>(address: AiAddress, action: (revision: number) => Promise<T>): Promise<T>;
  officeUndo(address: AiAddress, commitId: string, requestId: string): Promise<void>;
  preparePatch(address: AiAddress, message: Extract<HostToEditorMessage, { type: 'aiChat.applyPatches' }>): void;
}) {
  const lifetime = new AbortController(), polling = new Map<string, AbortController>();
  const ownedRequests = new Map<string, AiAddress>();
  const refreshed = new Set<string>();
  const decisions = new Map<string, { decisionId: string; accepted: boolean; editorRevision: number }>();
  async function request<T>(action: string, body: object): Promise<T> {
    lifetime.signal.throwIfAborted();
    const response = await fetch(`/api/easyview/v1/ai-${action}`, { method: 'POST', credentials: 'same-origin',
      body: JSON.stringify(body), signal: lifetime.signal });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'DSH AI 连接失败。');
    return result.value;
  }
  function hydrate(state: State, requestId: string, filePath: string) {
    for (const message of state.messages) if (!refreshed.has(message.id) && message.toolCalls?.some(call => call.name === 'easyview_create_markdown' && call.done)) {
      refreshed.add(message.id); options.filesChanged();
    }
    options.emit({ type: 'aiChat.hydrated', requestId, filePath, messages: state.messages.map(message => message.id === state.streamingMessageId ? { ...message, content: state.content } : message),
      activeRequestId: state.activeRequestId, streamingMessageId: state.streamingMessageId });
  }
  async function poll(address: AiAddress, requestId: string, filePath: string) {
    if (polling.has(requestId)) return;
    const controller = new AbortController(); polling.set(requestId, controller); ownedRequests.set(requestId, address);
    const delivered = new Set<string>();
    let previousText = '';
    let previousOffice = '';
    try {
      while (!controller.signal.aborted && !lifetime.signal.aborted) {
        const state = await request<State>('state', { address });
        if (!state.activeRequestId) {
          const final = [...state.messages].reverse().find(message => message.requestId === requestId && message.role === 'assistant');
          if (final?.error) options.emit({ type: 'aiChat.error', requestId, message: final.error, aborted: final.badge === 'stopped' });
          else options.emit({ type: 'aiChat.done', requestId, content: final?.content ?? '' });
          hydrate(state, requestId, filePath); return;
        }
        if (state.content.startsWith(previousText)) options.emit({ type: 'aiChat.delta', requestId, text: state.content.slice(previousText.length) });
        else hydrate(state, requestId, filePath);
        previousText = state.content;
        const office = JSON.stringify(state.messages.map(message => message.officeEdits));
        if (office !== previousOffice) { previousOffice = office; hydrate(state, requestId, filePath); }
        for (const event of state.events) if (event.type === 'aiChat.tool') {
          const key = `tool:${event.callId}:${event.phase}`;
          if (!delivered.has(key)) { delivered.add(key); options.emit(event); }
        } else if (event.type === 'aiChat.applyPatches' && !delivered.has(event.operationId)) {
          delivered.add(event.operationId);
          try { options.preparePatch(address, event); options.emit(event); }
          catch (error) { await request('ack', { address, requestId, operationId: event.operationId, error: String(error) }); }
        }
        await new Promise<void>(resolve => {
          const complete = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', complete); lifetime.signal.removeEventListener('abort', complete); resolve(); };
          const timer = setTimeout(complete, 200);
          controller.signal.addEventListener('abort', complete, { once: true }); lifetime.signal.addEventListener('abort', complete, { once: true });
        });
      }
    } catch (error) { if (!lifetime.signal.aborted) options.emit({ type: 'aiChat.error', requestId, message: String(error) }); }
    finally { polling.delete(requestId); ownedRequests.delete(requestId); }
  }
  async function handleAsync(message: EditorToHostMessage) {
    if (!message.type.startsWith('aiChat.')) return;
    if (message.type === 'aiChat.getSettings') {
      const models = await request<Array<{ label: string }>>('models', { address: options.address() });
      options.emit({ type: 'aiChat.settingsResponse', requestId: message.requestId, hasApiKey: true, hasWebSearchApiKey: false,
        settings: { ...DEFAULT_AI_CHAT_SETTINGS, models: models.map(model => model.label), defaultModel: models[0]?.label ?? '' } }); return;
    }
    if (message.type === 'aiChat.hydrate') {
      const address = options.address(message.filePath);
      if (!address.workspaceId) { hydrate({ messages: [], content: '', events: [] }, message.requestId, message.filePath); return; }
      const state = await request<State>('state', { address }); hydrate(state, message.requestId, message.filePath);
      if (state.activeRequestId) void poll(address, state.activeRequestId, message.filePath); return;
    }
    if (message.type === 'aiChat.clear') {
      const address = options.address(message.filePath);
      await request('clear', { address, requestId: message.requestId });
      hydrate(await request<State>('state', { address }), message.requestId, message.filePath); return;
    }
    if (message.type === 'aiChat.send') {
      if (message.attachments.length) throw new Error('当前 DSH 适配暂不支持图片附件。');
      await options.prepareContext(message.documentFilePath);
      await options.flush();
      const address = options.address(message.documentFilePath);
      await request('send', { address, input: { requestId: message.requestId, mode: message.mode, model: message.model, userMessage: message.userMessage } });
      // Never send the original UI's history or documentContent to DSH. The Host
      // owns both the visible-history cursor and confirmed document context.
      const state = await request<State>('state', { address });
      const path = message.documentFilePath ?? options.filePath();
      const filePath = /\.xlsx$/i.test(path) && !path.startsWith('preview:') ? `preview:${path}` : path;
      hydrate(state, message.requestId, filePath);
      void poll(address, message.requestId, filePath); return;
    }
    const address = 'requestId' in message ? ownedRequests.get(message.requestId) : undefined;
    if (message.type === 'aiChat.officeDecision' && address) {
      try {
        const decide = async (revision: number) => {
          let decision = decisions.get(message.proposalId);
          if (!decision) { decision = { decisionId: crypto.randomUUID(), accepted: message.accepted, editorRevision: revision }; decisions.set(message.proposalId, decision); }
          const result = await request<{ state: string; proposalId: string; operationId?: string; filePath: string }>('office-decision', {
            address, input: { proposalId: message.proposalId, ...decision } });
          return result;
        };
        const result = message.accepted ? await options.officeLease(address, decide) : await decide(0);
        if (result.state === 'committed' && result.operationId) options.emit({ type: 'aiChat.officeCommitted', requestId: message.requestId,
          proposalId: result.proposalId, commitId: result.operationId, filePath: result.filePath, backup: 'journal' });
        hydrate(await request<State>('state', { address }), message.requestId, `preview:${result.filePath}`);
      } catch (error) { await request('cancel', { address, requestId: message.requestId }).catch(() => {}); throw error; }
      return;
    }
    if (message.type === 'aiChat.officeUndo') {
      const current = options.address();
      try { await options.officeUndo(current, message.commitId, message.requestId);
        options.emit({ type: 'aiChat.officeUndone', requestId: message.requestId, commitId: message.commitId, filePath: options.filePath() });
      } catch (error) { options.emit({ type: 'aiChat.officeUndone', requestId: message.requestId, commitId: message.commitId, error: String(error) }); }
      return;
    }
    if (message.type === 'aiChat.abort' && address) { await request('cancel', { address, requestId: message.requestId }); return; }
    if (message.type === 'aiChat.patchesApplied' && address) { await request('ack', { address, requestId: message.requestId, operationId: message.operationId, error: message.error }); return; }
    if (message.type === 'aiChat.saveSettings' || message.type === 'aiChat.saveApiKey' || message.type === 'aiChat.saveWebSearchApiKey') {
      options.emit({ type: 'aiChat.settingsSaved', requestId: message.requestId, ok: false, message: '请在 DSH 设置中管理模型与密钥。' }); return;
    }
    if (message.type === 'aiChat.pickImage') options.emit({ type: 'aiChat.imagePicked', requestId: message.requestId, images: [], error: '当前 DSH 适配暂不支持图片附件。' });
  }
  return {
    handle(message: EditorToHostMessage): boolean {
      if (!message.type.startsWith('aiChat.')) return false;
      void handleAsync(message).catch(error => {
        if (!lifetime.signal.aborted && message.type === 'aiChat.clear') { window.alert(String(error)); return; }
        if (!lifetime.signal.aborted && 'requestId' in message) options.emit({ type: 'aiChat.error', requestId: message.requestId, message: String(error) });
      }); return true;
    },
    dispose() { lifetime.abort(); for (const controller of polling.values()) controller.abort(); polling.clear(); ownedRequests.clear(); },
  };
}
