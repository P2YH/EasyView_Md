import { setLocale } from '@easyview/contracts/i18n';
import type { EasyViewDesktopApi } from '../preload/desktopApi';

// Must be the renderer's first import: message lookups read the locale lazily, but some
// modules build UI during evaluation.
const locale = (window as Window & { easyViewDesktop?: Partial<EasyViewDesktopApi> }).easyViewDesktop?.app?.locale;
if (locale) {
  setLocale(locale);
  document.documentElement.lang = locale;
}
