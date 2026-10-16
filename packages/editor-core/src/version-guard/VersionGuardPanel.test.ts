/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import type { GuardClient, GuardRequest } from '@easyview/contracts';
import { VersionGuardPanel } from './VersionGuardPanel';

const commit = { hash: 'abc1234', parents: ['p'], message: 'First change', author: 'Tester', timestamp: 0 };
function client(): GuardClient & { calls: GuardRequest[] } {
  const calls: GuardRequest[] = [];
  return {
    calls,
    request: vi.fn(async (request: GuardRequest) => {
      calls.push(request);
      switch (request.method) {
        case 'discover': return [{ id: '/repo', name: 'repo', rootPath: '/repo' }];
        case 'status': return { files: [{ path: 'docs/a.md', index: '.', worktree: 'D', submodule: false }], branch: 'main', head: 'h', ahead: 0, behind: 0 };
        case 'history': return { entries: [commit] };
        case 'commitFiles': return [{ path: 'docs/a.md', index: 'M', worktree: '.', submodule: false }];
        default: return undefined;
      }
    }),
    subscribe: () => ({ dispose() {} }),
    loadState: () => ({ expanded: ['/repo'], drafts: {}, selected: '/repo' }),
    saveState: () => {},
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('VersionGuardPanel', () => {
  it('keeps the commit file list stable across status refreshes (no flicker)', async () => {
    const guard = client(); const panel = new VersionGuardPanel({ client: guard }); document.body.append(panel.element);
    panel.setVisible(true); for (let i = 0; i < 5; i++) await flush();
    panel.element.querySelector<HTMLButtonElement>('.guard-commit')!.click(); for (let i = 0; i < 3; i++) await flush();
    const row = panel.element.querySelector('.guard-history .guard-file'); expect(row).not.toBeNull();
    for (let i = 0; i < 5; i++) { panel.invalidate(null); await flush(); }
    expect(panel.element.querySelector('.guard-history .guard-file')).toBe(row);
    expect(guard.calls.filter(call => call.method === 'commitFiles')).toHaveLength(1);
    expect(panel.element.querySelector('.guard-history-head .guard-back')?.textContent).toBeTruthy();
    panel.dispose();
  });
  it('renders deleted files struck through, without the removed hint texts', async () => {
    const guard = client(); const panel = new VersionGuardPanel({ client: guard }); document.body.append(panel.element);
    panel.setVisible(true); for (let i = 0; i < 5; i++) await flush();
    expect(panel.element.querySelector('.guard-file.is-deleted')).not.toBeNull();
    expect(panel.element.querySelector('.guard-checked')).toBeNull();
    expect(panel.element.querySelector('textarea')?.getAttribute('rows')).toBe('1');
    panel.dispose();
  });
  it('indents nested repositories and collapses history by clicking its header', async () => {
    const guard = client();
    const base = guard.request;
    guard.request = vi.fn(async (request: GuardRequest) => request.method === 'discover'
      ? [{ id: '/repo', name: 'repo', rootPath: '/repo' }, { id: '/repo/sub', name: 'sub', rootPath: '/repo/sub' }]
      : base(request));
    const panel = new VersionGuardPanel({ client: guard }); document.body.append(panel.element);
    panel.setVisible(true); for (let i = 0; i < 6; i++) await flush();
    const sections = panel.element.querySelectorAll<HTMLElement>('.guard-repository');
    expect(sections[0].classList.contains('is-nested')).toBe(false);
    expect(sections[1].classList.contains('is-nested')).toBe(true);
    expect(sections[1].style.getPropertyValue('--guard-depth')).toBe('1');
    const head = () => panel.element.querySelector<HTMLElement>('.guard-history-head')!;
    expect(panel.element.querySelector('.guard-commit')).not.toBeNull();
    head().click();
    expect(head().getAttribute('aria-expanded')).toBe('false');
    expect(panel.element.querySelector('.guard-commit')).toBeNull();
    head().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(panel.element.querySelector('.guard-commit')).not.toBeNull();
    panel.dispose();
  });
});
