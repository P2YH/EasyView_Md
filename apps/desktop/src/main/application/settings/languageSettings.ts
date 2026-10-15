import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isLocalePreference, type LocalePreference } from '@easyview/contracts';
import { writeFileAtomically } from '@easyview/node-runtime';

const PREFERENCES_FILE = 'preferences.json';
/** Test/automation override; accepts the same values as the menu (system, zh-CN, en). */
export const LANGUAGE_OVERRIDE_ENV = 'EASYVIEW_DESKTOP_LANGUAGE';

interface DesktopPreferences {
  language?: LocalePreference;
}

let selectedPreference: LocalePreference = 'system';

function preferencesPath(userDataPath: string): string {
  return path.join(userDataPath, PREFERENCES_FILE);
}

function readPreferences(userDataPath: string): DesktopPreferences {
  try {
    const parsed: unknown = JSON.parse(readFileSync(preferencesPath(userDataPath), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed as DesktopPreferences : {};
  } catch {
    return {};
  }
}

/** Synchronous so it can run before `app.ready` (Chromium's --lang switch must be set early). */
export function loadLanguagePreference(userDataPath: string, env: NodeJS.ProcessEnv = process.env): LocalePreference {
  const override = env[LANGUAGE_OVERRIDE_ENV];
  const stored = readPreferences(userDataPath).language;
  selectedPreference = isLocalePreference(override) ? override : isLocalePreference(stored) ? stored : 'system';
  return selectedPreference;
}

/** The preference chosen in the menu; it may differ from the running locale until the app restarts. */
export function getSelectedLanguagePreference(): LocalePreference {
  return selectedPreference;
}

export async function saveLanguagePreference(userDataPath: string, language: LocalePreference): Promise<void> {
  const next: DesktopPreferences = { ...readPreferences(userDataPath), language };
  await writeFileAtomically(preferencesPath(userDataPath), `${JSON.stringify(next, null, 2)}\n`);
  selectedPreference = language;
}
