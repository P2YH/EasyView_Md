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

/** Fixed row geometry makes scrolling independent of the number of Git entries. */
export function windowedList(root: HTMLElement, rows: Array<() => HTMLElement>, rowHeight = 26): void {
  root.style.cssText = `overflow:auto;max-height:320px;height:${Math.min(320, rows.length * rowHeight)}px;position:relative`;
  const space = document.createElement('div'); space.style.height = `${rows.length * rowHeight}px`;
  const items = document.createElement('div'); items.style.cssText = 'position:absolute;top:0;left:0;right:0';
  root.replaceChildren(space, items);
  let previous = -1;
  const render = () => {
    const start = Math.max(0, Math.floor(root.scrollTop / rowHeight) - 4);
    if (start === previous) return; previous = start;
    const end = Math.min(rows.length, start + Math.ceil((root.clientHeight || 320) / rowHeight) + 8);
    items.style.transform = `translateY(${start * rowHeight}px)`;
    items.replaceChildren(...rows.slice(start, end).map(create => {
      const row = create(); row.style.height = `${rowHeight}px`; row.style.minHeight = '0'; row.style.boxSizing = 'border-box'; return row;
    }));
  };
  root.addEventListener('scroll', render, { passive: true }); render();
}
