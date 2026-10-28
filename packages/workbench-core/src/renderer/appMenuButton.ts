import type { EasyViewDesktopApi } from '../host';

interface AppMenuOptions {
  container: HTMLElement;
  label: string;
  popup: EasyViewDesktopApi['window']['popupAppMenu'];
  target?: Window;
}

/** Windows / Linux windows hide the native menu bar behind the shared tab row, so the menu opens from a
 * title-bar button or a lone Alt press (Alt+key accelerators still reach the menu as usual). */
export function installAppMenuButton({ container, label, popup, target = window }: AppMenuOptions): () => void {
  const button = document.createElement('button');
  button.id = 'app-menu-toggle';
  button.type = 'button';
  button.className = 'desktop-title-button';
  button.dataset.chromePinned = '';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'menu');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  container.prepend(button);

  const open = (): void => {
    const rect = button.getBoundingClientRect();
    void popup(rect.left, rect.bottom);
  };
  button.addEventListener('click', open);

  let altArmed = false;
  const onKeyDown = (event: KeyboardEvent): void => {
    altArmed = event.key === 'Alt' && !event.repeat && !event.ctrlKey && !event.shiftKey && !event.metaKey;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt' || !altArmed) return;
    altArmed = false;
    event.preventDefault();
    open();
  };
  const disarm = (): void => { altArmed = false; };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('pointerdown', disarm, true);
  target.addEventListener('blur', disarm);

  return () => {
    button.remove();
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    target.removeEventListener('pointerdown', disarm, true);
    target.removeEventListener('blur', disarm);
  };
}
