import { getLocale } from '@easyview/contracts';
import { app, BrowserWindow, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tAbout } from './aboutDialog.i18n';

export interface AboutInfo {
  version: string;
  /** ISO date `YYYY-MM-DD` from package.json `releaseDate`, when present. */
  releaseDate?: string;
}

/** Reads version / release date from the packaged package.json (offline, no network). */
export function readAboutInfo(appPath = app.getAppPath(), version = app.getVersion()): AboutInfo {
  let releaseDate: string | undefined;
  try {
    const raw = JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8')) as { releaseDate?: unknown };
    if (typeof raw.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.releaseDate)) {
      releaseDate = raw.releaseDate.slice(0, 10);
    }
  } catch {
    // package.json missing or unreadable — version alone is still shown
  }
  return { version, releaseDate };
}

export function formatReleaseDate(isoDate: string, locale = getLocale()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : 'en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function aboutDetail(info: AboutInfo): string {
  const lines = [tAbout('version', { version: info.version })];
  if (info.releaseDate) {
    lines.push(tAbout('releaseDate', { date: formatReleaseDate(info.releaseDate) }));
  }
  return lines.join('\n');
}

export async function showAboutDialog(): Promise<void> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: tAbout('title'),
    message: 'EasyView_Md',
    detail: aboutDetail(readAboutInfo()),
    buttons: [tAbout('close')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  if (window) await dialog.showMessageBox(window, options);
  else await dialog.showMessageBox(options);
}
