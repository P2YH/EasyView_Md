import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { tUpdate } from './updateService.i18n';

export type UpdateDialogPhase = 'downloading' | 'preparing' | 'ready' | 'failed';
export type UpdateDialogAction = 'cancel' | 'restart' | 'install' | 'later' | 'website' | 'close';

export interface UpdateDialogState {
  phase: UpdateDialogPhase;
  title: string;
  message: string;
  detail?: string;
  percent?: number;
  /** Primary action when ready: Mac in-place restart, or open the installer. */
  readyAction?: 'restart' | 'install';
}

type ActionHandler = (action: UpdateDialogAction) => void;

let window: BrowserWindow | undefined;
let onAction: ActionHandler | undefined;
let onCancel: (() => void) | undefined;
let lastState: UpdateDialogState | undefined;
let ipcBound = false;

const PRELOAD = path.join(__dirname, '../../preload/updateDialogPreload.js');

function dialogHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title></title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: Canvas; color: CanvasText; user-select: none; }
  body { display: flex; flex-direction: column; padding: 18px 20px 16px; box-sizing: border-box; }
  h1 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
  #message { margin: 0; font-size: 13px; }
  #detail { margin: 8px 0 0; font-size: 12px; opacity: 0.75; white-space: pre-wrap; word-break: break-word; max-height: 72px; overflow: auto; }
  #progressWrap { margin-top: 14px; }
  progress { width: 100%; height: 8px; }
  #percent { margin-top: 6px; font-size: 12px; opacity: 0.75; text-align: right; }
  #actions { margin-top: auto; display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; }
  button { min-width: 72px; padding: 5px 12px; font: inherit; border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText); color: CanvasText; cursor: pointer; }
  button.primary { background: #0a84ff; border-color: #0a84ff; color: #fff; }
  button:active { filter: brightness(0.95); }
  button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 1px; }
  .hidden { display: none !important; }
</style></head>
<body>
  <h1 id="title"></h1>
  <p id="message"></p>
  <p id="detail" class="hidden"></p>
  <div id="progressWrap" class="hidden"><progress id="bar" max="100" value="0"></progress><div id="percent"></div></div>
  <div id="actions"></div>
  <script>
    const api = window.easyviewUpdateDialog;
    const title = document.getElementById('title');
    const message = document.getElementById('message');
    const detail = document.getElementById('detail');
    const progressWrap = document.getElementById('progressWrap');
    const bar = document.getElementById('bar');
    const percent = document.getElementById('percent');
    const actions = document.getElementById('actions');
    function button(label, action, primary) {
      const el = document.createElement('button');
      el.textContent = label;
      if (primary) el.className = 'primary';
      el.addEventListener('click', () => api.action(action));
      return el;
    }
    function render(state) {
      title.textContent = state.title || '';
      message.textContent = state.message || '';
      if (state.detail) { detail.textContent = state.detail; detail.classList.remove('hidden'); }
      else { detail.textContent = ''; detail.classList.add('hidden'); }
      const showProgress = state.phase === 'downloading' || state.phase === 'preparing';
      progressWrap.classList.toggle('hidden', !showProgress);
      if (showProgress) {
        const indeterminate = state.phase === 'preparing' && !(Number(state.percent) > 0);
        if (indeterminate) {
          bar.removeAttribute('value');
          percent.textContent = '';
        } else {
          const value = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
          bar.value = value;
          percent.textContent = value + '%';
        }
      }
      actions.replaceChildren();
      if (state.phase === 'downloading' || state.phase === 'preparing') {
        actions.append(button(state.cancelLabel || 'Cancel', 'cancel', false));
      } else if (state.phase === 'ready') {
        actions.append(button(state.laterLabel || 'Later', 'later', false));
        const primary = state.readyAction === 'install' ? 'install' : 'restart';
        actions.append(button(state.actionLabel || 'OK', primary, true));
      } else if (state.phase === 'failed') {
        actions.append(button(state.closeLabel || 'Close', 'close', false));
        actions.append(button(state.websiteLabel || 'Website', 'website', true));
      }
    }
    api.onState(render);
  </script>
</body></html>`;
}

function ensureIpc(): void {
  if (ipcBound) return;
  ipcBound = true;
  ipcMain.on('easyview-update-dialog-action', (_event, action: UpdateDialogAction) => {
    if (action === 'cancel') onCancel?.();
    onAction?.(action);
  });
}

function labelsFor(state: UpdateDialogState): Record<string, string> {
  return {
    cancelLabel: tUpdate('download.cancel'),
    laterLabel: tUpdate('ready.later'),
    actionLabel: state.readyAction === 'install' ? tUpdate('ready.install') : tUpdate('ready.restart'),
    closeLabel: tUpdate('download.close'),
    websiteLabel: tUpdate('prompt.website'),
  };
}

function pushState(state: UpdateDialogState): void {
  lastState = state;
  if (!window || window.isDestroyed()) return;
  window.webContents.send('easyview-update-dialog-state', { ...state, ...labelsFor(state) });
}

export function isUpdateProgressDialogOpen(): boolean {
  return Boolean(window && !window.isDestroyed());
}

export async function openUpdateProgressDialog(parent?: BrowserWindow): Promise<void> {
  ensureIpc();
  if (window && !window.isDestroyed()) {
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 400,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    title: tUpdate('prompt.title'),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: Boolean(parent && !parent.isDestroyed()),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  const current = window;
  current.on('closed', () => {
    if (window === current) window = undefined;
  });
  current.on('close', (event) => {
    if (lastState?.phase === 'downloading' || lastState?.phase === 'preparing') {
      event.preventDefault();
      onCancel?.();
      onAction?.('cancel');
    }
  });
  await current.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(dialogHtml())}`);
  if (lastState) pushState(lastState);
  if (!current.isDestroyed()) current.show();
}

export function setUpdateProgressState(state: UpdateDialogState): void {
  pushState(state);
  if (window && !window.isDestroyed() && state.title) window.setTitle(state.title);
}

export function setUpdateProgressPercent(percent: number): void {
  if (!lastState || (lastState.phase !== 'downloading' && lastState.phase !== 'preparing')) return;
  setUpdateProgressState({ ...lastState, percent: Math.max(0, Math.min(100, percent)) });
}

export function closeUpdateProgressDialog(): void {
  const current = window;
  window = undefined;
  lastState = undefined;
  onAction = undefined;
  onCancel = undefined;
  if (current && !current.isDestroyed()) {
    current.removeAllListeners('close');
    current.destroy();
  }
}

/** Invoked when the user cancels during download/prepare (button or window close). */
export function setUpdateDialogCancelHandler(handler: (() => void) | undefined): void {
  onCancel = handler;
}

/** Resolves when the user picks an action in the ready/failed states. */
export function waitForUpdateDialogAction(): Promise<UpdateDialogAction> {
  return new Promise((resolve) => {
    onAction = (action) => {
      if (action === 'cancel') return;
      onAction = undefined;
      resolve(action);
    };
  });
}

export function updateDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}
