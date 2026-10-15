import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSelectedLanguagePreference, loadLanguagePreference, saveLanguagePreference } from './languageSettings';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'easyview-language-'));
}

describe('languageSettings', () => {
  it('defaults to following the system when nothing is stored', async () => {
    expect(loadLanguagePreference(await tempDir(), {})).toBe('system');
  });

  it('round-trips the saved preference and keeps unrelated keys', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'preferences.json'), JSON.stringify({ other: 1 }));
    await saveLanguagePreference(dir, 'en');
    expect(getSelectedLanguagePreference()).toBe('en');
    expect(loadLanguagePreference(dir, {})).toBe('en');
    expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8'))).toEqual({ other: 1, language: 'en' });
  });

  it('ignores invalid stored values and honours the environment override', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'preferences.json'), JSON.stringify({ language: 'fr' }));
    expect(loadLanguagePreference(dir, {})).toBe('system');
    expect(loadLanguagePreference(dir, { EASYVIEW_DESKTOP_LANGUAGE: 'zh-CN' })).toBe('zh-CN');
  });
});
