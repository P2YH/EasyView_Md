import { describe, expect, it } from 'vitest';
import { EditorAppearanceStore } from './EditorAppearance';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe('EditorAppearanceStore depth', () => {
  it('remembers a separate depth for each theme mode', () => {
    const storage = memoryStorage();
    const store = new EditorAppearanceStore(storage, 'light');
    store.setDepth(0.2);
    store.setMode('dark');
    expect(store.state.depth).toBe(0.5);
    store.setDepth(0.9);
    store.setMode('gray');
    expect(store.state.depth).toBe(0.5);
    store.setMode('light');
    expect(store.state.depth).toBe(0.2);
    store.setMode('dark');
    expect(store.state.depth).toBe(0.9);

    const reloaded = new EditorAppearanceStore(storage, 'light');
    expect(reloaded.state).toMatchObject({ mode: 'dark', depth: 0.9 });
    reloaded.setMode('light');
    expect(reloaded.state.depth).toBe(0.2);
  });

  it('migrates the old shared depth to the active mode only', () => {
    const storage = memoryStorage({ 'mdpre-zalman-theme-depth': '0.7' });
    const store = new EditorAppearanceStore(storage, 'gray');
    expect(store.state).toMatchObject({ mode: 'gray', depth: 0.7 });
    expect(storage.data.get('mdpre-zalman-theme-depth-gray')).toBe('0.7');
    store.setMode('dark');
    expect(store.state.depth).toBe(0.5);
  });
});
