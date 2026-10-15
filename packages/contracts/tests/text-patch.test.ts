import { afterEach, describe, expect, it } from 'vitest';
import { applyAiTextPatches } from '../src/ai/text-patch';
import { resetLocale, setLocale } from '../src/i18n/i18n';

describe('applyAiTextPatches', () => {
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
