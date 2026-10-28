import { afterEach, describe, expect, it } from 'vitest';
import { applyAiTextPatches } from './text-patch';
import { resetLocale, setLocale } from '../i18n/i18n';

describe('applyAiTextPatches', () => {
  it('allows one insertion into an empty document and rejects ambiguous empty anchors', () => {
    const patch = { description: 'Start a draft', expectedText: '', replacement: '# New document\n' };
    expect(applyAiTextPatches('', [patch])).toBe('# New document\n');
    expect(() => applyAiTextPatches('existing content', [patch])).toThrow();
    expect(() => applyAiTextPatches('', [patch, patch])).toThrow();
  });
  afterEach(() => resetLocale());

  it('applies independent exact patches atomically', () => {
    expect(applyAiTextPatches('# Title\n\nFirst\n\nLast\n', [
      { description: 'Append a note', expectedText: 'Last\n', replacement: 'Last\nAppended\n' },
      { description: 'Rename heading', expectedText: '# Title', replacement: '# Updated' },
    ])).toBe('# Updated\n\nFirst\n\nLast\nAppended\n');
  });

  it('rejects missing, ambiguous, and overlapping anchors', () => {
    expect(() => applyAiTextPatches('same\nsame\n', [{ description: 'x', expectedText: 'same', replacement: 'next' }])).toThrow('匹配多处');
    expect(() => applyAiTextPatches('abc', [{ description: 'x', expectedText: 'missing', replacement: '' }])).toThrow('未匹配');
  });

  it('reports errors in the active locale', () => {
    setLocale('en');
    expect(() => applyAiTextPatches('abc', [])).toThrow('At least one patch is required');
    expect(() => applyAiTextPatches('abc', [{ description: 'x', expectedText: 'missing', replacement: '' }])).toThrow('does not match');
  });
});
