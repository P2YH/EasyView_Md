import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_CHAT_SETTINGS, normalizeAiChatSettings } from '../src/ai/ai-chat';

describe('AI chat settings', () => {
  it('defaults to the current DeepSeek models', () => {
    expect(normalizeAiChatSettings(undefined)).toMatchObject({ models: ['deepseek-flash', 'deepseek-v4-pro'], defaultModel: 'deepseek-flash' });
  });

  it('upgrades an untouched legacy default list and keeps user-edited lists', () => {
    expect(normalizeAiChatSettings({ models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-reasoner' }))
      .toMatchObject({ models: DEFAULT_AI_CHAT_SETTINGS.models, defaultModel: 'deepseek-flash' });
    expect(normalizeAiChatSettings({ models: ['deepseek-chat', 'qwen-max'], defaultModel: 'qwen-max' }))
      .toMatchObject({ models: ['deepseek-chat', 'qwen-max'], defaultModel: 'qwen-max' });
  });
});
