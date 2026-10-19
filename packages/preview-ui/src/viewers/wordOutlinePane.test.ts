/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installWordOutline, WORD_OUTLINE_ROW_HEIGHT, type WordOutlineLabels, type WordOutlineSource } from './wordOutlinePane';
import type { WordOutlineHeading } from './wordOutline';

const labels: WordOutlineLabels = {
  title: '目录', empty: '未找到标题', inferred: '推断', inferredHint: 'hint', expand: '展开', collapse: '折叠',
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function fakeSource(initial: WordOutlineHeading[] | null) {
  let headings = initial;
  let notify: () => void = () => undefined;
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const revealed: string[] = [];
  const source: WordOutlineSource = {
    collect: () => headings,
    scroller: () => scroller,
    tops: list => list.map(h => h.index * 100),
    reveal: (heading) => { revealed.push(heading.text); },
    observe: (cb) => { notify = cb; return () => { notify = () => undefined; }; },
  };
  return {
    source,
    scroller,
    revealed,
    set(next: WordOutlineHeading[] | null) { headings = next; notify(); },
  };
}

const h = (level: number, text: string, index: number, inferred = false): WordOutlineHeading => ({ level, text, index, inferred });
const texts = (pane: HTMLElement) => Array.from(pane.querySelectorAll('.preview-word-outline-item'))
  .sort((a, b) => parseFloat((a as HTMLElement).style.top) - parseFloat((b as HTMLElement).style.top))
  .map(el => el.textContent);

it('stays in a loading state without flashing the empty message, then shows the tree', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const fake = fakeSource(null);
  const outline = installWordOutline(container, fake.source, labels);
  expect(outline.pane.dataset.state).toBe('loading');
  fake.set([h(1, '第一章', 0), h(2, '1.1', 1), h(3, '1.1.1', 2), h(1, '第二章', 3)]);
  vi.advanceTimersByTime(300);
  expect(outline.pane.dataset.state).toBe('ready');
  // Expanded two levels deep: 1.1.1 is hidden under the collapsed 1.1.
  expect(texts(outline.pane)).toEqual(['第一章', '1.1', '第二章']);
  const sub = outline.pane.querySelector<HTMLElement>('.preview-word-outline-item[data-id="1"]')!;
  expect(sub.getAttribute('aria-expanded')).toBe('false');
  sub.querySelector<HTMLButtonElement>('.preview-word-outline-twisty')!.click();
  expect(texts(outline.pane)).toEqual(['第一章', '1.1', '1.1.1', '第二章']);
  outline.dispose();
  expect(container.querySelector('.preview-word-outline')).toBeNull();
});

it('shows the empty state when the document has no headings', () => {
  const fake = fakeSource([]);
  const outline = installWordOutline(document.body, fake.source, labels);
  expect(outline.pane.dataset.state).toBe('empty');
  expect(outline.pane.querySelector('.preview-word-outline-empty')!.textContent).toBe('未找到标题');
  outline.dispose();
});

it('jumps on click and tracks the current section while scrolling', () => {
  const fake = fakeSource([h(1, 'A', 0), h(1, 'B', 1), h(1, 'C', 2)]);
  const outline = installWordOutline(document.body, fake.source, labels);
  const active = () => outline.pane.querySelector('.preview-word-outline-item.is-active')?.textContent;
  expect(active()).toBe('A');
  outline.pane.querySelector<HTMLElement>('.preview-word-outline-item[data-id="2"] .preview-word-outline-text')!.click();
  expect(fake.revealed).toEqual(['C']);
  expect(active()).toBe('C');
  vi.advanceTimersByTime(700);
  fake.scroller.scrollTop = 150;
  fake.scroller.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(100);
  expect(active()).toBe('B');
  outline.dispose();
});

it('marks inferred outlines and re-collects after edits (debounced)', () => {
  const fake = fakeSource([h(1, 'Old', 0, true)]);
  const outline = installWordOutline(document.body, fake.source, labels);
  expect(outline.pane.querySelector<HTMLElement>('.preview-word-outline-badge')!.hidden).toBe(false);
  fake.set([h(1, 'New', 0)]);
  vi.advanceTimersByTime(200);
  expect(texts(outline.pane)).toEqual(['Old']);
  vi.advanceTimersByTime(150);
  expect(texts(outline.pane)).toEqual(['New']);
  expect(outline.pane.querySelector<HTMLElement>('.preview-word-outline-badge')!.hidden).toBe(true);
  outline.dispose();
});

it('virtualises long outlines', () => {
  const many = Array.from({ length: 2000 }, (_, i) => h(1, `Heading ${i}`, i));
  const fake = fakeSource(many);
  const outline = installWordOutline(document.body, fake.source, labels);
  const rendered = outline.pane.querySelectorAll('.preview-word-outline-item').length;
  expect(rendered).toBeGreaterThan(10);
  expect(rendered).toBeLessThan(100);
  const spacer = outline.pane.querySelector<HTMLElement>('.preview-word-outline-spacer')!;
  expect(parseInt(spacer.style.height, 10)).toBeGreaterThanOrEqual(2000 * WORD_OUTLINE_ROW_HEIGHT);
  outline.dispose();
});
