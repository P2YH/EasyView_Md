/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import type { TimelineComparison } from '@easyview/contracts';
import { HistoryView } from './HistoryView';

const comparison: TimelineComparison = {
  entry: { id: 'k', source: 'git', filePath: '/repo/book.xlsx', timestamp: 0, label: 'Working tree' },
  base: '', content: '', baseLabel: 'Index', contentLabel: 'Working tree',
  spreadsheet: {
    base: [{ name: 'Same', rows: [['x']] }, { name: 'Data', rows: [['h'], ['1'], ['2'], ['3']] }],
    content: [{ name: 'Same', rows: [['x']] }, { name: 'Data', rows: [['h'], ['1'], ['2b'], ['3'], ['4']] }],
  },
};
const rows = (pane: Element) => [...pane.querySelectorAll('tbody tr')].map(row => [row.className, row.querySelector('th')?.textContent ?? '', row.querySelector('td')?.textContent ?? '']);

describe('spreadsheet history view', () => {
  it('opens the first changed sheet with aligned, highlighted rows on both sides', () => {
    const root = document.createElement('main'); document.body.append(root);
    const view = new HistoryView(root, comparison, 'unused-worker.js');
    expect([...root.querySelectorAll('.evsd-tab')].map(tab => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['Same', 'false'], ['Data2', 'true']]);
    const [base, content] = root.querySelectorAll('.evsd-pane');
    expect(rows(base)).toEqual([['is-same', '1', 'h'], ['is-same', '2', '1'], ['is-modified', '3', '2'], ['is-same', '4', '3'], ['is-added is-placeholder', '', '']]);
    expect(rows(content)).toEqual([['is-same', '1', 'h'], ['is-same', '2', '1'], ['is-modified', '3', '2b'], ['is-same', '4', '3'], ['is-added', '5', '4']]);
    expect(base.querySelector('td.is-old')?.getAttribute('title')).toBe('A3: 2 → 2b');
    expect(content.querySelectorAll('td.is-new')).toHaveLength(2);
    view.dispose(); expect(root.childElementCount).toBe(0);
  });
  it('collapses unchanged rows when filtering to changes', () => {
    const root = document.createElement('main'); document.body.append(root);
    new HistoryView(root, comparison, 'unused-worker.js');
    const toggle = root.querySelector<HTMLInputElement>('.evsd-filter input')!; toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    const [, content] = root.querySelectorAll('.evsd-pane');
    expect(rows(content).map(([kind]) => kind)).toEqual(['evsd-gap', 'is-modified', 'evsd-gap', 'is-added']);
  });
});
