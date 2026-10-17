/** @vitest-environment happy-dom */
import { expect, it } from 'vitest';
import { LruCache, windowedList } from './guardList';
it('bounds the cache and touches recently read entries', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  expect(cache.size).toBe(2); expect(cache.has('b')).toBe(false); expect(cache.get('a')).toBe(1);
});
it('renders a bounded viewport for 50,000 files and reaches the final row', () => {
  const root = document.createElement('div');
  windowedList(root, Array.from({ length: 50_000 }, (_, i) => () => { const row = document.createElement('button'); row.textContent = String(i); return row; }));
  expect(root.querySelectorAll('button').length).toBeLessThan(25);
  root.scrollTop = 49990 * 26; root.dispatchEvent(new Event('scroll'));
  expect(root.textContent).toContain('49999'); expect(root.querySelectorAll('button').length).toBeLessThan(25);
});
