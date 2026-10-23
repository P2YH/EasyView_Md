/** Insertion order is recency order; bounded across repositories. */
export class LruCache<K, V> {
  private values = new Map<K, V>();
  constructor(readonly capacity: number) {}
  get size(): number { return this.values.size; }
  has(key: K): boolean { return this.values.has(key); }
  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value !== undefined) { this.values.delete(key); this.values.set(key, value); }
    return value;
  }
  set(key: K, value: V): void {
    this.values.delete(key); this.values.set(key, value);
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
  }
  delete(key: K): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

/**
 * Fixed row geometry makes scrolling independent of the number of Git entries. The list takes its
 * full height and is windowed against `scroller`, the panel region that already scrolls, so long
 * lists use the whole panel instead of a nested fixed-height box.
 */
export function windowedList(root: HTMLElement, rows: Array<() => HTMLElement>, scroller: HTMLElement, rowHeight = 26): void {
  root.style.cssText = `position:relative;height:${rows.length * rowHeight}px`;
  const items = document.createElement('div'); items.style.cssText = 'position:absolute;top:0;left:0;right:0';
  root.replaceChildren(items);
  let previous = '';
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => render()) : undefined;
  const detach = () => { scroller.removeEventListener('scroll', render); observer?.disconnect(); };
  function render(): void {
    // Panels rebuild their lists on refresh; a replaced list stops listening the next time it is asked to render.
    if (previous && !root.isConnected) { detach(); return; }
    const offset = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const viewport = scroller.clientHeight || 320;
    const start = Math.min(rows.length, Math.max(0, Math.floor(-offset / rowHeight) - 4));
    const end = Math.min(rows.length, Math.max(start, Math.ceil((viewport - offset) / rowHeight) + 4));
    const key = `${start}:${end}`; if (key === previous) return; previous = key;
    items.style.transform = `translateY(${start * rowHeight}px)`;
    items.replaceChildren(...rows.slice(start, end).map(create => {
      const row = create(); row.style.height = `${rowHeight}px`; row.style.minHeight = '0'; row.style.boxSizing = 'border-box'; return row;
    }));
  }
  scroller.addEventListener('scroll', render, { passive: true }); observer?.observe(scroller); render();
  // The list is usually attached after this call returns; place it once layout is known.
  requestAnimationFrame(render);
}
