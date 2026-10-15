import { afterEach, describe, expect, it } from 'vitest';
import {
  defineMessages,
  formatMessage,
  getLocale,
  normalizeLocale,
  resetLocale,
  resolveLocalePreference,
  setLocale,
  validateMessageCatalog,
  type MessageCatalog,
  type MessageDictionary,
} from '../src/i18n/i18n';

type ViteImportMeta = ImportMeta & {
  glob<T>(patterns: string[], options: { eager: true }): Record<string, T>;
};

const catalogModules = (import.meta as ViteImportMeta).glob<Record<string, unknown>>(
  ['../../../packages/*/src/**/*.i18n.ts', '../../../apps/*/src/**/*.i18n.ts'],
  { eager: true },
);

function isTranslator(value: unknown): value is { catalog: MessageCatalog<MessageDictionary> } {
  return typeof value === 'function' && 'catalog' in value;
}

afterEach(() => resetLocale());

describe('i18n', () => {
  it('maps every Chinese variant to zh-CN and everything else to en', () => {
    expect(normalizeLocale('zh-cn')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeLocale('zh_Hans_CN')).toBe('zh-CN');
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ja')).toBe('en');
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale(undefined)).toBeUndefined();
  });

  it('resolves explicit preferences before the system language list', () => {
    expect(resolveLocalePreference('en', ['zh-CN'])).toBe('en');
    expect(resolveLocalePreference('zh-CN', ['en-US'])).toBe('zh-CN');
    expect(resolveLocalePreference('system', ['en-GB', 'zh-CN'])).toBe('en');
    expect(resolveLocalePreference('system', ['', 'zh-Hans'])).toBe('zh-CN');
    expect(resolveLocalePreference(undefined, [])).toBe('zh-CN');
  });

  it('formats named placeholders and leaves unknown ones intact', () => {
    expect(formatMessage('打开 {name}（{count}）', { name: 'a.md', count: 2 })).toBe('打开 a.md（2）');
    expect(formatMessage('{missing} ok', {})).toBe('{missing} ok');
  });

  it('translates with the current locale', () => {
    const t = defineMessages({ 'zh-CN': { hello: '你好，{name}' }, en: { hello: 'Hello, {name}' } });
    expect(getLocale()).toBe('zh-CN');
    expect(t('hello', { name: 'A' })).toBe('你好，A');
    setLocale('en');
    expect(t('hello', { name: 'A' })).toBe('Hello, A');
  });

  it('reports placeholder mismatches and empty texts', () => {
    expect(validateMessageCatalog({ 'zh-CN': { a: '{x} 项', b: '' }, en: { a: '{y} items', b: 'B' } })).toEqual([
      'a: placeholders differ (zh-CN {x} vs en {y})',
      'b: missing zh-CN text',
    ]);
  });

  it('keeps every product message catalog consistent across locales', () => {
    const catalogs = Object.entries(catalogModules).flatMap(([file, exports]) =>
      Object.values(exports).filter(isTranslator).map((translator) => ({ file, catalog: translator.catalog })));
    expect(catalogs.length).toBeGreaterThan(0);
    const problems = catalogs.flatMap(({ file, catalog }) =>
      validateMessageCatalog(catalog).map((problem) => `${file.replace(/^(\.\.\/)+/, '')} ${problem}`));
    expect(problems).toEqual([]);
  });
});
