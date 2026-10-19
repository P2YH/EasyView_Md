/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { installTitleBarOverlaySync } from './titleBarOverlaySync';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('paints the overlay like the top row on start and after appearance changes, skipping repeats', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  const source = document.createElement('div');
  source.style.backgroundColor = 'rgb(236, 236, 236)';
  source.style.color = 'rgb(51, 51, 51)';
  document.body.append(source);
  const apply = vi.fn();
  let notify = (): void => undefined;
  const unsubscribe = vi.fn();
  const dispose = installTitleBarOverlaySync({ source, apply, subscribe: (listener) => { notify = listener; return unsubscribe; } });

  expect(apply).toHaveBeenLastCalledWith('rgb(236, 236, 236)', 'rgb(51, 51, 51)');
  notify();
  expect(apply).toHaveBeenCalledTimes(1);

  source.style.backgroundColor = 'rgb(37, 37, 38)';
  source.style.color = 'rgb(204, 204, 204)';
  notify();
  expect(apply).toHaveBeenLastCalledWith('rgb(37, 37, 38)', 'rgb(204, 204, 204)');

  dispose();
  expect(unsubscribe).toHaveBeenCalled();
});
