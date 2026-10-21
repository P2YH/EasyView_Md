// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { reserveToolbarChrome } from './SpreadsheetViewer';

/** Guards the fix for CI failure (a): the x-spreadsheet overflow button must not cover our Save/theme chrome. */
describe('reserveToolbarChrome', () => {
  function setup(toolbarWidth: number, slotWidth: number) {
    const toolbar = document.createElement('div');
    const slot = document.createElement('div');
    toolbar.getBoundingClientRect = () => new DOMRect(10, 0, toolbarWidth, 40);
    slot.getBoundingClientRect = () => new DOMRect(0, 0, slotWidth, 40);
    toolbar.appendChild(slot);
    document.body.appendChild(toolbar);
    return { toolbar, slot };
  }

  it('subtracts the chrome slot width plus a gap from the measured toolbar width', () => {
    const { toolbar } = setup(900, 120);
    reserveToolbarChrome(toolbar, toolbar.firstElementChild as HTMLElement);
    const rect = toolbar.getBoundingClientRect();
    expect(rect.width).toBe(900 - 120 - 16);
    expect(rect.x).toBe(10);
    expect(rect.height).toBe(40);
  });

  it('reserves nothing once the slot is detached and never goes negative', () => {
    const { toolbar, slot } = setup(100, 300);
    reserveToolbarChrome(toolbar, slot);
    expect(toolbar.getBoundingClientRect().width).toBe(0);
    slot.remove();
    expect(toolbar.getBoundingClientRect().width).toBe(100);
  });

  it('is idempotent and re-lays-out the toolbar after the engine has initialised', () => {
    vi.useFakeTimers();
    let callback: (() => void) | undefined;
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { callback = cb; } observe = observe; disconnect() {} });
    const { toolbar, slot } = setup(900, 100);
    reserveToolbarChrome(toolbar, slot);
    reserveToolbarChrome(toolbar, slot);
    expect(toolbar.getBoundingClientRect().width).toBe(784);
    expect(observe).toHaveBeenCalledTimes(1);
    const onResize = vi.fn();
    window.addEventListener('resize', onResize);
    callback?.();
    expect(onResize).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onResize).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
