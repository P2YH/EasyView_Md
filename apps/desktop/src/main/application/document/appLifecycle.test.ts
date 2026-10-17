import { describe, expect, it, vi } from 'vitest';
import { requestRestart, type RestartWindow } from './appLifecycle';

function window(dirty: boolean, confirmed = true): RestartWindow & { dirty: boolean } {
  const owner = { dirty, prepare: vi.fn().mockResolvedValue(undefined), hasDirtyDocuments: () => owner.dirty,
    confirmCloseAll: vi.fn(async () => { if (confirmed) owner.dirty = false; return confirmed; }), };
  return owner;
}

describe('application restart', () => {
  it('confirms a dirty background window even when the invoking window is clean', async () => {
    const background = window(true), active = window(false), relaunch = vi.fn();
    expect(await requestRestart({ windows: () => [background, active], relaunch })).toBe(true);
    expect(background.confirmCloseAll).toHaveBeenCalledTimes(1);
    expect(active.confirmCloseAll).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
  it('aborts the global restart when any window cancels', async () => {
    const relaunch = vi.fn();
    expect(await requestRestart({ windows: () => [window(false), window(true, false)], relaunch })).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('flushes debounced edits before checking whether a window is dirty', async () => {
    const owner = window(false), relaunch = vi.fn();
    vi.mocked(owner.prepare).mockImplementationOnce(async () => { owner.dirty = true; });
    await requestRestart({ windows: () => [owner], relaunch });
    expect(owner.confirmCloseAll).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
  it('checks edits made in an already confirmed window while another prompt is open', async () => {
    const first = window(true), second = window(true), relaunch = vi.fn();
    vi.mocked(second.confirmCloseAll).mockImplementationOnce(async () => { second.dirty = false; first.dirty = true; return true; });
    await requestRestart({ windows: () => [first, second], relaunch });
    expect(first.confirmCloseAll).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
  it('restarts clean windows without asking for confirmation', async () => {
    const owner = window(false), relaunch = vi.fn();
    await requestRestart({ windows: () => [owner], relaunch });
    expect(owner.confirmCloseAll).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
