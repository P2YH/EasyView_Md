import { describe, expect, it } from 'vitest';
import { PreviewToolbarPinIcon } from './shared';

function pathD(expand: boolean): string {
  const icon = PreviewToolbarPinIcon({ expand });
  const path = (icon.props as { children?: { props?: { d?: string } } }).children;
  return path?.props?.d ?? '';
}

describe('PreviewToolbarPinIcon', () => {
  it('uses up chevron to collapse and down chevron to expand', () => {
    expect(pathD(false)).toBe('M3.5 10 8 5.5 12.5 10');
    expect(pathD(true)).toBe('M3.5 6 8 10.5 12.5 6');
  });
});
