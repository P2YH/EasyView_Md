interface TitleBarOverlaySyncOptions {
  /** The top-row element the native window controls sit on. */
  source: HTMLElement;
  apply(color: string, symbolColor: string): unknown;
  /** Notifies after the product appearance changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

/** Keeps the native minimise / maximise / close overlay painted like the renderer's top row. */
export function installTitleBarOverlaySync({ source, apply, subscribe }: TitleBarOverlaySyncOptions): () => void {
  let frame = 0;
  let pending = false;
  let last = '';
  const sync = (): void => {
    pending = false;
    const style = getComputedStyle(source);
    const color = style.backgroundColor;
    const symbolColor = style.color;
    if (!color || !symbolColor || TRANSPARENT.test(color)) return;
    const key = `${color}|${symbolColor}`;
    if (key === last) return;
    last = key;
    void apply(color, symbolColor);
  };
  const schedule = (): void => {
    if (pending) return;
    pending = true;
    frame = requestAnimationFrame(sync);
  };
  const unsubscribe = subscribe(schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    unsubscribe();
  };
}
