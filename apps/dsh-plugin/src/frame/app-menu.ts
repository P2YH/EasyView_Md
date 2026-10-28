import { operationSuccess, type OperationResult } from '@easyview/contracts';
import type { EasyViewDesktopApi } from '@easyview/workbench-core/host';

/** DSH has no Electron Menu in its frame; use the original menu button and Alt shortcut. */
export function installDshAppMenu(api: EasyViewDesktopApi, actions: {
  openFolder(): Promise<OperationResult<unknown>>;
  switchWorkspace(): Promise<OperationResult<unknown>>;
  showWelcome(): Promise<void>;
}, signal: AbortSignal): void {
  const menu = document.createElement('div');
  menu.id = 'easyview-app-menu'; menu.className = 'easyview-app-menu'; menu.hidden = true;
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '文档工作台菜单');
  const items: HTMLButtonElement[] = [];
  let opener: HTMLElement | null = null, busy = false;
  const toggle = () => document.getElementById('app-menu-toggle') as HTMLButtonElement | null;
  const close = (restoreFocus = true) => {
    menu.hidden = true; toggle()?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && opener?.isConnected) opener.focus();
  };
  for (const [id, label, action] of [
    ['easyview-open-folder', '打开文件夹', actions.openFolder],
    ['easyview-workspace-switch', '切换工作区', actions.switchWorkspace],
    ['easyview-show-welcome', '返回欢迎页', actions.showWelcome],
  ] as const) {
    const item = document.createElement('button');
    item.id = id; item.type = 'button'; item.textContent = label; item.tabIndex = -1;
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => {
      if (busy) return;
      close(); busy = true;
      const button = toggle(); if (button) button.disabled = true;
      void Promise.resolve().then<OperationResult<unknown> | void>(action).then(result => {
        if (!signal.aborted && result && !result.ok && result.code !== 'CONFLICT') window.alert(result.message);
      }).catch(() => { if (!signal.aborted) window.alert('操作未完成，请稍后重试。'); })
        .finally(() => { busy = false; if (button?.isConnected) button.disabled = false; });
    }, { signal });
    items.push(item); menu.append(item);
  }
  document.body.append(menu);
  const previous = api.window.popupAppMenu;
  api.window.popupAppMenu = async (left, top) => {
    if (signal.aborted || busy) return operationSuccess(false);
    if (!menu.hidden) { close(); return operationSuccess(true); }
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : toggle();
    toggle()?.setAttribute('aria-controls', menu.id); toggle()?.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(top + 4, window.innerHeight - rect.height - 4))}px`;
    items[0].focus();
    return operationSuccess(true);
  };
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && event.target instanceof Element && !menu.contains(event.target) && !event.target.closest('#app-menu-toggle')) close(false);
  }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }, { capture: true, signal });
  window.addEventListener('resize', () => close(false), { signal });
  signal.addEventListener('abort', () => { close(false); menu.remove(); api.window.popupAppMenu = previous; }, { once: true });
}
