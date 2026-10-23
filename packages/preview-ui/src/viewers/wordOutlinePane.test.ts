/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installWordOutline, WORD_OUTLINE_ROW_HEIGHT, type WordOutlineLabels, type WordOutlineSource } from './wordOutlinePane';
import type { WordOutlineHeading } from './wordOutline';
import { WORD_OUTLINE_PINNED_KEY, WORD_OUTLINE_SIDE_KEY } from './wordOutlinePrefs';

const labels: WordOutlineLabels = {
  title: '目录', empty: '未找到标题', inferred: '推断', inferredHint: 'hint', expand: '展开', collapse: '折叠',
  pin: '固定目录', unpin: '收起为迷你目录', miniMapLabel: '文档目录', dock: '拖到左侧或右侧',
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(WORD_OUTLINE_PINNED_KEY, '1'); // existing tests exercise the pinned sidebar
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  localStorage.clear();
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
  expect(container.querySelector('.preview-word-minimap')).toBeNull();
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

it('defaults to the pulse minimap and pins into a full sidebar', () => {
  localStorage.setItem(WORD_OUTLINE_PINNED_KEY, '0');
  const container = document.createElement('div');
  container.className = 'preview-word-mount';
  document.body.append(container);
  const fake = fakeSource([h(1, 'Root', 0), h(2, 'Child', 1), h(3, 'Leaf', 2)]);
  const outline = installWordOutline(container, fake.source, labels);
  expect(outline.pane.hidden).toBe(true);
  expect(outline.minimap.hidden).toBe(false);
  expect(container.dataset.wordOutlineMode).toBe('minimap');
  expect(Array.from(outline.minimap.querySelectorAll('.preview-word-minimap-dash')).map((d) => (d as HTMLElement).dataset.depth)).toEqual(['0', '1', '2']);
  expect(Array.from(outline.minimap.querySelectorAll('.preview-word-minimap-item')).map((el) => el.textContent)).toEqual(['Root', 'Child', 'Leaf']);

  outline.minimap.querySelector<HTMLButtonElement>('.preview-word-minimap-pin')!.click();
  expect(outline.pane.hidden).toBe(false);
  expect(outline.minimap.hidden).toBe(true);
  expect(container.dataset.wordOutlineMode).toBe('sidebar');
  expect(container.dataset.previewSidebar).toBe('visible');
  expect(localStorage.getItem(WORD_OUTLINE_PINNED_KEY)).toBe('1');
  expect(texts(outline.pane)).toEqual(['Root', 'Child']);

  outline.pane.querySelector<HTMLButtonElement>('.preview-word-outline-unpin')!.click();
  expect(outline.pane.hidden).toBe(true);
  expect(outline.minimap.hidden).toBe(false);
  expect(localStorage.getItem(WORD_OUTLINE_PINNED_KEY)).toBe('0');
  outline.dispose();
});

it('opens the scrollable minimap popup on rail click and docks left/right', () => {
  localStorage.setItem(WORD_OUTLINE_PINNED_KEY, '0');
  const container = document.createElement('div');
  container.className = 'preview-word-mount';
  document.body.append(container);
  const fake = fakeSource([h(1, 'A', 0), h(1, 'B', 1)]);
  const outline = installWordOutline(container, fake.source, labels);
  expect(outline.minimap.classList.contains('is-open')).toBe(false);
  outline.minimap.querySelector<HTMLElement>('.preview-word-minimap-rail')!.click();
  expect(outline.minimap.classList.contains('is-open')).toBe(true);

  outline.setPinned(true);
  expect(container.dataset.wordOutlineSide).toBe('left');
  outline.setSide('right');
  expect(container.dataset.wordOutlineSide).toBe('right');
  expect(outline.pane.classList.contains('preview-word-outline-right')).toBe(true);
  expect(localStorage.getItem(WORD_OUTLINE_SIDE_KEY)).toBe('right');
  expect(outline.pane.querySelector('.preview-word-outline-dock-grip')).not.toBeNull();
  outline.dispose();
});

it('navigates from the minimap popup list', () => {
  localStorage.setItem(WORD_OUTLINE_PINNED_KEY, '0');
  const fake = fakeSource([h(1, 'A', 0), h(1, 'B', 1)]);
  const outline = installWordOutline(document.body, fake.source, labels);
  const b = Array.from(outline.minimap.querySelectorAll<HTMLButtonElement>('.preview-word-minimap-item')).find((el) => el.textContent === 'B')!;
  b.click();
  expect(fake.revealed).toEqual(['B']);
  expect(b.classList.contains('active')).toBe(true);
  outline.dispose();
});
