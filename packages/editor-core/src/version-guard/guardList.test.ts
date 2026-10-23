/** @vitest-environment happy-dom */
import { expect, it } from 'vitest';
import { LruCache, windowedList } from './guardList';
it('bounds the cache and touches recently read entries', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  expect(cache.size).toBe(2); expect(cache.has('b')).toBe(false); expect(cache.get('a')).toBe(1);
});
it('renders a bounded viewport for 50,000 files and reaches the final row', () => {
  const scroller = document.createElement('div'); const root = document.createElement('div'); scroller.append(root); document.body.append(scroller);
  windowedList(root, Array.from({ length: 50_000 }, (_, i) => () => { const row = document.createElement('button'); row.textContent = String(i); return row; }), scroller);
  expect(root.style.height).toBe(`${50_000 * 26}px`);
  expect(root.querySelectorAll('button').length).toBeLessThan(25);
  root.getBoundingClientRect = () => ({ top: -49990 * 26 } as DOMRect);
  scroller.dispatchEvent(new Event('scroll'));
  expect(root.textContent).toContain('49999'); expect(root.querySelectorAll('button').length).toBeLessThan(25);
  scroller.remove();
});
it('stops following the scroller once the list is replaced', () => {
  const scroller = document.createElement('div'); const root = document.createElement('div'); scroller.append(root); document.body.append(scroller);
  let created = 0;
  windowedList(root, Array.from({ length: 1000 }, () => () => { created++; return document.createElement('div'); }), scroller);
  root.remove(); const before = created;
  root.getBoundingClientRect = () => ({ top: -500 * 26 } as DOMRect);
  scroller.dispatchEvent(new Event('scroll')); scroller.dispatchEvent(new Event('scroll'));
  expect(created).toBe(before);
  scroller.remove();
});
