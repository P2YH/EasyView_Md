/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalHistorySettings } from '@easyview/contracts';
import { showHistorySettingsDialog } from './HistorySettingsDialog';

afterEach(() => document.body.replaceChildren());

const settings: LocalHistorySettings = { enabled: true, maxFileSize: 256, maxFileEntries: 50, mergeWindow: 10 };

const open = async (save = vi.fn(async () => {})) => {
  const closed = showHistorySettingsDialog(async () => settings, save);
  await vi.waitFor(() => expect(document.querySelector('.easyview-settings-dialog')).not.toBeNull());
  const inputs = [...document.querySelectorAll<HTMLInputElement>('.easyview-settings-input')];
  const [, saveButton] = [...document.querySelectorAll<HTMLButtonElement>('.easyview-settings-footer button')];
  return { closed, save, inputs, saveButton };
};

it('uses the shared settings dialog and saves validated values', async () => {
  const { closed, save, inputs, saveButton } = await open();
  expect(document.querySelector('.easyview-settings-title')?.textContent).toBe('本地历史设置');
  expect(inputs.map((input) => input.value)).toEqual(['256', '50', '10']);
  document.querySelector<HTMLInputElement>('.easyview-settings-check input')!.click();
  inputs[2].value = '30';
  saveButton.click();
  await closed;
  expect(save).toHaveBeenCalledWith({ enabled: false, maxFileSize: 256, maxFileEntries: 50, mergeWindow: 30 });
  expect(document.querySelector('.easyview-settings-overlay')).toBeNull();
});

it('keeps the dialog open with an error for invalid numbers', async () => {
  const { save, inputs, saveButton } = await open();
  inputs[0].value = '0';
  saveButton.click();
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector('.easyview-settings-error')?.textContent).not.toBe('');
  expect(document.querySelector('.easyview-settings-overlay')).not.toBeNull();
});

it('shows save failures without closing', async () => {
  const { saveButton } = await open(vi.fn(async () => { throw new Error('disk full'); }));
  saveButton.click();
  await vi.waitFor(() => expect(document.querySelector('.easyview-settings-error')?.textContent).toContain('disk full'));
  expect(saveButton.disabled).toBe(false);
});
