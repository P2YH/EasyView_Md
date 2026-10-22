// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatBytes } from './shared';

describe('formatBytes', () => {
  it('uses the unit that matches the magnitude', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(77_830)).toBe('76 KB');
    expect(formatBytes(2_987_280)).toBe('2.8 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});
