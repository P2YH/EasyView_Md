/** @vitest-environment happy-dom */
import type { WorkspaceEntry, WorkspaceSearchResult } from '@easyview/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSearchPanel } from './WorkspaceSearchPanel';

function entry(relativePath: string, kind: WorkspaceEntry['kind'] = 'file'): WorkspaceEntry {
  return { id: relativePath, rootId: 'root', relativePath, name: relativePath.split('/').at(-1)!, kind };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function key(input: HTMLInputElement, name: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

describe('WorkspaceSearchPanel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function setup(result: WorkspaceSearchResult | null) {
    const search = vi.fn(async () => result);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onQueryActiveChange = vi.fn();
    const panel = new WorkspaceSearchPanel({ search, onOpen, onClose, onQueryActiveChange });
    document.body.appendChild(panel.element);
    const input = panel.element.querySelector<HTMLInputElement>('.workspace-search-input')!;
    return { panel, input, search, onOpen, onClose, onQueryActiveChange };
  }

  it('debounces the query, renders highlighted results with parent paths, and opens with Enter', async () => {
    const { panel, input, search, onOpen, onQueryActiveChange } = setup({
      entries: [entry('docs/guide.md'), entry('guide', 'directory')],
      truncated: false,
    });
    type(input, 'gu');
    type(input, 'guide');
    expect(panel.hasQuery).toBe(true);
    expect(onQueryActiveChange).toHaveBeenCalledTimes(1);
    expect(panel.element.querySelector('.workspace-search-status')?.textContent).toBe('搜索中…');
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('guide');

    const rows = [...panel.element.querySelectorAll<HTMLElement>('.workspace-search-result')];
    expect(rows.map((row) => row.dataset.relativePath)).toEqual(['docs/guide.md', 'guide']);
    expect(rows[0].querySelector('mark')?.textContent).toBe('guide');
    expect(rows[0].querySelector('.workspace-search-result-path')?.textContent).toBe('docs');
    expect(rows[0].classList.contains('is-active')).toBe(true);

    key(input, 'ArrowDown');
    expect(panel.element.querySelector('.workspace-search-result.is-active')?.getAttribute('data-relative-path')).toBe('guide');
    key(input, 'Enter');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'guide', kind: 'directory' }));
  });

  it('shows empty and truncated states', async () => {
    const empty = setup({ entries: [], truncated: false });
    type(empty.input, 'zzz');
    await vi.runAllTimersAsync();
    expect(empty.panel.element.querySelector('.workspace-search-status')?.textContent).toBe('没有找到匹配的文件或文件夹');

    const many = setup({ entries: [entry('a.md')], truncated: true });
    type(many.input, 'a');
    await vi.runAllTimersAsync();
    expect(many.panel.element.querySelector('.workspace-search-status')?.textContent).toBe('结果较多，仅显示前 1 条');
  });

  it('clears the query on the first Escape and closes on the second', async () => {
    const { panel, input, onClose, onQueryActiveChange } = setup({ entries: [], truncated: false });
    type(input, 'x');
    key(input, 'Escape');
    expect(panel.hasQuery).toBe(false);
    expect(input.value).toBe('');
    expect(onQueryActiveChange).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    key(input, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for IME composition to end before reacting, and leaves composition keys to the IME', async () => {
    const { panel, input, search, onClose, onQueryActiveChange } = setup({ entries: [entry('合计.md')], truncated: false });
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = 'he';
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    expect(panel.hasQuery).toBe(false);
    expect(onQueryActiveChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    input.value = '合计';
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '合计' }));
    input.dispatchEvent(new InputEvent('input', { isComposing: false }));
    expect(onQueryActiveChange).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('合计');
  });

  it('ignores responses that arrive after the query changed', async () => {
    let resolveFirst: (value: WorkspaceSearchResult) => void = () => {};
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise<WorkspaceSearchResult>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async () => ({ entries: [entry('new.md')], truncated: false }));
    const panel = new WorkspaceSearchPanel({ search, onOpen: vi.fn(), onClose: vi.fn(), onQueryActiveChange: vi.fn() });
    const input = panel.element.querySelector<HTMLInputElement>('.workspace-search-input')!;
    type(input, 'old');
    await vi.advanceTimersByTimeAsync(200);
    type(input, 'new');
    await vi.advanceTimersByTimeAsync(200);
    resolveFirst({ entries: [entry('old.md')], truncated: false });
    await vi.runAllTimersAsync();
    expect([...panel.element.querySelectorAll<HTMLElement>('.workspace-search-result')].map((row) => row.dataset.relativePath))
      .toEqual(['new.md']);
  });
});
