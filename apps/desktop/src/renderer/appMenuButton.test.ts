/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { installAppMenuButton } from './appMenuButton';
import { applyTitleBarToggles } from './panelDock';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup() {
  const container = document.createElement('div');
  document.body.append(container);
  const popup = vi.fn().mockResolvedValue({ ok: true, value: true });
  const dispose = installAppMenuButton({ container, label: 'Menu (Alt)', popup });
  const button = container.querySelector<HTMLButtonElement>('#app-menu-toggle')!;
  return { container, popup, dispose, button };
}

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent(type, { cancelable: true, ...init }));

it('opens the application menu below the button on click', () => {
  const { popup, button } = setup();
  button.getBoundingClientRect = () => ({ left: 6, bottom: 30 } as DOMRect);
  button.click();
  expect(popup).toHaveBeenCalledWith(6, 30);
  expect(button.getAttribute('aria-label')).toBe('Menu (Alt)');
});

it('opens on a lone Alt press but not for Alt accelerators or after disposal', () => {
  const { popup, dispose, container } = setup();
  key('keydown', { key: 'Alt', altKey: true });
  key('keyup', { key: 'Alt' });
  expect(popup).toHaveBeenCalledTimes(1);

  key('keydown', { key: 'Alt', altKey: true });
  key('keydown', { key: 'v', altKey: true });
  key('keyup', { key: 'v', altKey: true });
  key('keyup', { key: 'Alt' });
  expect(popup).toHaveBeenCalledTimes(1);

  dispose();
  key('keydown', { key: 'Alt', altKey: true });
  key('keyup', { key: 'Alt' });
  expect(popup).toHaveBeenCalledTimes(1);
  expect(container.querySelector('#app-menu-toggle')).toBeNull();
});

it('stays first when panel toggles are laid out in the same container', () => {
  const { container, button } = setup();
  const toggles = { explorer: document.createElement('button'), aiChat: document.createElement('button'), versionGuard: document.createElement('button') };
  applyTitleBarToggles(
    { left: ['explorer', 'versionGuard'], right: ['aiChat'], outline: 'left' },
    { left: container, right: document.createElement('div'), toggles },
  );
  expect([...container.children]).toEqual([button, toggles.explorer, toggles.versionGuard]);
});
