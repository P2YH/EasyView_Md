/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { openWorkspaceSettingsDialog, type WorkspaceSettingsValues } from './WorkspaceSettingsDialog';

afterEach(() => document.body.replaceChildren());

const values: WorkspaceSettingsValues = {
  displayMode: 'list',
  sortMode: 'name',
  showCreatedAt: false,
  showUpdatedAt: false,
  showTimestampHover: true,
  showDotEntries: true,
  fontSizeOffset: 0,
};

const open = () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const handle = openWorkspaceSettingsDialog({ values, baseFontSize: 16, onSave, onClose });
  const query = <T extends Element>(selector: string) => handle.element.querySelector<T>(selector)!;
  return { handle, onSave, onClose, query };
};

it('stages edits in a form and applies them only on Save', () => {
  const { handle, onSave, onClose, query } = open();
  expect(handle.element.parentElement).toBe(document.body);
  const dialog = query('[role="dialog"]');
  expect(document.activeElement).toBe(dialog);
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('文件面板设置');
  expect([...handle.element.querySelectorAll('.easyview-settings-label')].map((label) => label.textContent))
    .toEqual(['显示方式', '排序方式', '字号', '显示内容', '显示类型']);

  query<HTMLButtonElement>('[role="radio"][data-value="icons"]').click();
  expect(query('[role="radio"][data-value="icons"]').getAttribute('aria-checked')).toBe('true');
  expect(query('[role="radio"][data-value="list"]').getAttribute('aria-checked')).toBe('false');
  query<HTMLButtonElement>('[role="radio"][data-value="custom"]').click();
  query<HTMLButtonElement>('[aria-label="增大字号"]').click();
  expect(query('.easyview-settings-stepper-value').textContent).toBe('17px');
  const created = query<HTMLInputElement>('.easyview-settings-check input');
  created.checked = true;
  created.dispatchEvent(new Event('change'));
  expect(onSave).not.toHaveBeenCalled();

  [...handle.element.querySelectorAll<HTMLButtonElement>('.easyview-settings-footer button')]
    .find((button) => button.textContent === '保存')!.click();
  expect(onSave).toHaveBeenCalledWith({ ...values, displayMode: 'icons', sortMode: 'custom', fontSizeOffset: 1, showCreatedAt: true });
  expect(onClose).toHaveBeenCalledOnce();
  expect(handle.element.isConnected).toBe(false);
});

it('discards edits on Cancel, Escape, the close button and backdrop clicks', () => {
  const close = [
    (query: ReturnType<typeof open>['query']) => [...query('.easyview-settings-footer').querySelectorAll<HTMLButtonElement>('button')][0].click(),
    (query: ReturnType<typeof open>['query']) => query('.easyview-settings-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    (query: ReturnType<typeof open>['query']) => query<HTMLButtonElement>('.easyview-settings-close').click(),
    (query: ReturnType<typeof open>['query']) => query('.easyview-settings-overlay').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
  ];
  for (const action of close) {
    const { handle, onSave, onClose, query } = open();
    query<HTMLButtonElement>('[role="radio"][data-value="icons"]').click();
    query('.easyview-settings-dialog').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    action((selector) => (selector === '.easyview-settings-overlay' ? handle.element : handle.element.querySelector(selector)!) as never);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(handle.element.isConnected).toBe(false);
  }
});
