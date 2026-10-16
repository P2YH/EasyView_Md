import type { LocalHistorySettings } from '@easyview/contracts';
import { openSettingsDialog, settingsCheckbox } from '../ui/SettingsDialog';
import { tTimeline } from './timeline.i18n';

type NumericKey = keyof Pick<LocalHistorySettings, 'maxFileSize' | 'maxFileEntries' | 'mergeWindow'>;

export async function showHistorySettingsDialog(load: () => Promise<LocalHistorySettings>, save: (settings: LocalHistorySettings) => Promise<void>): Promise<void> {
  const settings = await load();
  let enabled = settings.enabled;
  const numeric: Array<[NumericKey, string, number]> = [
    ['maxFileSize', tTimeline('settings.maxFileSize'), 1],
    ['maxFileEntries', tTimeline('settings.maxFileEntries'), 0],
    ['mergeWindow', tTimeline('settings.mergeWindow'), 1],
  ];
  const inputs = new Map<NumericKey, HTMLInputElement>();
  const fields = numeric.map(([key, label, min]) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'easyview-settings-input';
    input.min = String(min);
    input.step = '1';
    input.value = String(settings[key]);
    input.setAttribute('aria-label', label);
    inputs.set(key, input);
    return { label, control: input };
  });
  await new Promise<void>((resolve) => {
    const dialog = openSettingsDialog({
      title: tTimeline('settings.title'),
      fields: [
        { label: tTimeline('settings.localHistory'), control: settingsCheckbox(tTimeline('settings.enabled'), enabled, (checked) => { enabled = checked; }) },
        ...fields,
      ],
      onSave: () => {
        const next: LocalHistorySettings = {
          enabled,
          maxFileSize: Number(inputs.get('maxFileSize')!.value),
          maxFileEntries: Number(inputs.get('maxFileEntries')!.value),
          mergeWindow: Number(inputs.get('mergeWindow')!.value),
        };
        if (numeric.some(([key, , min]) => !Number.isInteger(next[key]) || next[key] < min)) {
          dialog.setError(tTimeline('settings.invalidInteger'));
          return false;
        }
        return save(next);
      },
      onClose: resolve,
    });
  });
}
