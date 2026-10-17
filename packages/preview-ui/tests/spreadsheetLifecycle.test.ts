/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { bindSpreadsheetEvent, SpreadsheetLifecycle, spreadsheetSetTimeout } from '../src/spreadsheet/spreadsheetLifecycle';

describe('spreadsheet resource ownership', () => {
  it('removes an instance and its delayed work without disabling the other instance', () => {
    vi.useFakeTimers();
    try {
      const first = new SpreadsheetLifecycle(), second = new SpreadsheetLifecycle();
      const firstResize = vi.fn(), secondResize = vi.fn(), delayed = vi.fn();
      first.run(() => { bindSpreadsheetEvent(window, 'resize', firstResize); spreadsheetSetTimeout(delayed, 20); });
      second.run(() => bindSpreadsheetEvent(window, 'resize', secondResize));
      first.dispose();
      window.dispatchEvent(new Event('resize'));
      vi.runAllTimers();
      expect(firstResize).not.toHaveBeenCalled(); expect(delayed).not.toHaveBeenCalled();
      expect(secondResize).toHaveBeenCalledTimes(1);
      expect(first.resources.size).toBe(0);
      second.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('owns listeners registered later by a menu callback', () => {
    const owner = new SpreadsheetLifecycle(), outside = vi.fn();
    owner.run(() => bindSpreadsheetEvent(window, 'spreadsheet-menu', () => bindSpreadsheetEvent(document.body, 'click', outside)));
    window.dispatchEvent(new Event('spreadsheet-menu'));
    owner.dispose();
    document.body.click();
    expect(outside).not.toHaveBeenCalled();
  });
});
