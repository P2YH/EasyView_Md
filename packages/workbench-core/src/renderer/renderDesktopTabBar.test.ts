/** @vitest-environment happy-dom */
import { expect, it, vi } from 'vitest';
import { resolveWorkspaceTreeIcon } from '@easyview/contracts';
import type { DesktopTab } from '../contracts';
import { renderDesktopTabBar } from './renderDesktopTabBar';

it('uses the workspace tree icon for every tab kind', () => {
  const tabs = [
    { id: 'a', kind: 'editor', filePath: '/w/notes.md', fileName: 'notes.md', dirty: false, documentKey: 'a' },
    { id: 'b', kind: 'preview', relativePath: 'deck.pptx', fileName: 'deck.pptx' },
    { id: 'c', kind: 'preview', relativePath: 'photo.png', fileName: 'photo.png' },
  ] as unknown as DesktopTab[];
  const container = document.createElement('div');
  renderDesktopTabBar(container, tabs, 'a', { onActivate: vi.fn(), onClose: vi.fn(), onContextMenu: vi.fn(), onUnpin: vi.fn() });

  const icons = [...container.querySelectorAll<HTMLElement>('.desktop-tab-icon')];
  expect(icons.map((icon) => icon.dataset.icon)).toEqual(['seti:markdown', 'seti:powerpoint', 'seti:image']);
  icons.forEach((icon, index) => {
    const expected = document.createElement('span');
    expected.innerHTML = resolveWorkspaceTreeIcon({ kind: 'file', name: tabs[index].fileName }).svg;
    expect(icon.innerHTML).toBe(expected.innerHTML);
  });
});

it('shows a pin button on pinned tabs that unpins instead of closing', () => {
  const tabs = [
    { id: 'a', kind: 'preview', relativePath: 'a.pdf', fileName: 'a.pdf', pinned: true },
    { id: 'b', kind: 'preview', relativePath: 'b.pdf', fileName: 'b.pdf' },
  ] as unknown as DesktopTab[];
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onContextMenu: vi.fn(), onUnpin: vi.fn() };
  const container = document.createElement('div');
  renderDesktopTabBar(container, tabs, 'a', handlers);

  const [pinned, regular] = [...container.querySelectorAll<HTMLElement>('.desktop-tab')];
  expect(pinned.classList.contains('pinned')).toBe(true);
  expect(regular.classList.contains('pinned')).toBe(false);
  pinned.querySelector<HTMLButtonElement>('.desktop-tab-pin')!.click();
  regular.querySelector<HTMLButtonElement>('.desktop-tab-close')!.click();

  expect(handlers.onUnpin).toHaveBeenCalledWith('a');
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  expect(handlers.onClose).toHaveBeenCalledWith('b');
});

it('scrolls overflowing tabs sideways with a vertical wheel and binds only once', () => {
  const tabs = [{ id: 'a', kind: 'preview', relativePath: 'a.pdf', fileName: 'a.pdf' }] as unknown as DesktopTab[];
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onContextMenu: vi.fn(), onUnpin: vi.fn() };
  const container = document.createElement('div');
  renderDesktopTabBar(container, tabs, 'a', handlers);
  const row = container.querySelector<HTMLElement>('.desktop-tab-row-regular')!;
  Object.defineProperty(row, 'scrollWidth', { value: 800 });
  Object.defineProperty(row, 'clientWidth', { value: 300 });
  renderDesktopTabBar(container, tabs, 'a', handlers);
  expect(container.querySelector('.desktop-tab-row-regular')).toBe(row);

  const vertical = new WheelEvent('wheel', { deltaY: 40, cancelable: true });
  row.dispatchEvent(vertical);
  expect(row.scrollLeft).toBe(40);
  expect(vertical.defaultPrevented).toBe(true);

  const horizontal = new WheelEvent('wheel', { deltaX: 30, deltaY: 5, cancelable: true });
  row.dispatchEvent(horizontal);
  expect(row.scrollLeft).toBe(40);
  expect(horizontal.defaultPrevented).toBe(false);
});

it('puts pinned tabs on their own row above the regular tabs and moves them on pin changes', () => {
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onContextMenu: vi.fn(), onUnpin: vi.fn() };
  const container = document.createElement('div');
  const tab = (id: string, pinned = false) => ({ id, kind: 'preview', relativePath: `${id}.md`, fileName: `${id}.md`, pinned });
  const ids = (selector: string) => [...container.querySelectorAll<HTMLElement>(`${selector} .desktop-tab`)].map((item) => item.dataset.tabId);
  const rows = () => [...container.children].map((row) => (row as HTMLElement).dataset.row);

  renderDesktopTabBar(container, [tab('a'), tab('b'), tab('c')] as unknown as DesktopTab[], 'b', handlers);
  expect(rows()).toEqual(['regular']);
  expect(container.classList.contains('has-pinned-row')).toBe(false);

  renderDesktopTabBar(container, [tab('b', true), tab('a'), tab('c')] as unknown as DesktopTab[], 'b', handlers);
  expect(rows()).toEqual(['pinned', 'regular']);
  expect(container.classList.contains('has-pinned-row')).toBe(true);
  expect(ids('.desktop-tab-row-pinned')).toEqual(['b']);
  expect(ids('.desktop-tab-row-regular')).toEqual(['a', 'c']);
  expect(container.querySelector('.desktop-tab-row-pinned .desktop-tab.active')).not.toBeNull();

  renderDesktopTabBar(container, [tab('a'), tab('b'), tab('c')] as unknown as DesktopTab[], 'b', handlers);
  expect(rows()).toEqual(['regular']);
  expect(ids('.desktop-tab-row-regular')).toEqual(['a', 'b', 'c']);

  renderDesktopTabBar(container, [tab('a', true)] as unknown as DesktopTab[], 'a', handlers);
  expect(rows()).toEqual(['pinned']);
});
