export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export type LocalePreference = 'system' | Locale;
export const LOCALE_PREFERENCES: readonly LocalePreference[] = ['system', 'zh-CN', 'en'];
export const DEFAULT_LOCALE: Locale = 'zh-CN';

export type MessageParams = Readonly<Record<string, string | number>>;
export type MessageDictionary = Readonly<Record<string, string>>;
export interface MessageCatalog<M extends MessageDictionary> {
  readonly 'zh-CN': M;
  readonly en: { readonly [K in keyof M]: string };
}
export interface Translator<K extends string> {
  (key: K, params?: MessageParams): string;
  readonly catalog: MessageCatalog<Readonly<Record<K, string>>>;
}

const LOCALE_GLOBAL_KEY = '__easyviewLocale';
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

type LocaleGlobal = typeof globalThis & {
  [LOCALE_GLOBAL_KEY]?: Locale;
  document?: { documentElement?: { lang?: string } | null };
};

/** Maps any BCP 47 tag to a supported locale: every Chinese variant → zh-CN, everything else → en. */
export function normalizeLocale(tag: string | null | undefined): Locale | undefined {
  const value = tag?.trim().toLowerCase().replace('_', '-');
  if (!value) return undefined;
  return value === 'zh' || value.startsWith('zh-') ? 'zh-CN' : 'en';
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return typeof value === 'string' && (LOCALE_PREFERENCES as readonly string[]).includes(value);
}

export function resolveLocalePreference(
  preference: LocalePreference | undefined,
  systemLanguages: readonly (string | null | undefined)[],
): Locale {
  if (preference && preference !== 'system') return preference;
  for (const tag of systemLanguages) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/** Process/page-wide UI locale. Hosts set it once at startup; switching languages requires a restart. */
export function setLocale(locale: Locale): void {
  (globalThis as LocaleGlobal)[LOCALE_GLOBAL_KEY] = locale;
}

/** Drops the explicit locale so lookups fall back to `<html lang>` or the default (used by tests). */
export function resetLocale(): void {
  delete (globalThis as LocaleGlobal)[LOCALE_GLOBAL_KEY];
}

export function getLocale(): Locale {
  const scope = globalThis as LocaleGlobal;
  return scope[LOCALE_GLOBAL_KEY] ?? normalizeLocale(scope.document?.documentElement?.lang) ?? DEFAULT_LOCALE;
}

export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function defineMessages<M extends MessageDictionary>(catalog: MessageCatalog<M>): Translator<keyof M & string> {
  const translate = ((key: keyof M & string, params?: MessageParams) => {
    const dictionary: MessageDictionary = catalog[getLocale()];
    return formatMessage(dictionary[key] ?? catalog['zh-CN'][key] ?? key, params);
  }) as Translator<keyof M & string>;
  Object.defineProperty(translate, 'catalog', { value: catalog });
  return translate;
}

function placeholdersOf(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]))].sort();
}

/** Reports keys whose translations are empty or use different placeholders across locales. */
export function validateMessageCatalog(catalog: MessageCatalog<MessageDictionary>): string[] {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(catalog['zh-CN']), ...Object.keys(catalog.en)]);
  for (const key of keys) {
    const zh = catalog['zh-CN'][key];
    const en = catalog.en[key];
    if (typeof zh !== 'string' || !zh.trim()) problems.push(`${key}: missing zh-CN text`);
    if (typeof en !== 'string' || !en.trim()) problems.push(`${key}: missing en text`);
    if (typeof zh === 'string' && typeof en === 'string' && placeholdersOf(zh).join() !== placeholdersOf(en).join()) {
      problems.push(`${key}: placeholders differ (zh-CN {${placeholdersOf(zh).join(', ')}} vs en {${placeholdersOf(en).join(', ')}})`);
    }
  }
  return problems;
}
