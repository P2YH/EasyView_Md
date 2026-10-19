/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { installWindowChrome } from './windowChrome';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('places the no-drag title controls after the draggable workbench so their clicks are not swallowed', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.innerHTML = `
    <div id="desktop-root">
      <div id="desktop-window-chrome"><div id="left"></div><div id="right"></div></div>
      <div id="desktop-workbench"><div class="desktop-tab-bar"></div></div>
    </div>`;
  const root = document.getElementById('desktop-root')!;
  const dispose = installWindowChrome({
    workbench: document.getElementById('desktop-workbench')!,
    leading: document.getElementById('left')!,
    trailing: document.getElementById('right')!,
  });

  expect([...root.children].map((child) => child.id)).toEqual(['desktop-workbench', 'desktop-window-chrome']);
  dispose();
});
