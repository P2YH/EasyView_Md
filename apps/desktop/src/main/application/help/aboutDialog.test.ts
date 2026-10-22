import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { setLocale } from '@easyview/contracts';
import { aboutDetail, formatReleaseDate, readAboutInfo } from './aboutDialog';

describe('readAboutInfo', () => {
  it('reads releaseDate from package.json', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'easyview-about-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.2.3', releaseDate: '2026-10-21' }));
    expect(readAboutInfo(dir, '2.2.3')).toEqual({ version: '2.2.3', releaseDate: '2026-10-21' });
  });

  it('omits releaseDate when missing or invalid', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'easyview-about-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.2.3', releaseDate: 'soon' }));
    expect(readAboutInfo(dir, '2.2.3')).toEqual({ version: '2.2.3' });
  });
});

describe('formatReleaseDate', () => {
  it('formats for Chinese and English', () => {
    expect(formatReleaseDate('2026-10-21', 'zh-CN')).toBe('2026年10月21日');
    expect(formatReleaseDate('2026-10-21', 'en')).toMatch(/October\s+21,\s+2026/);
  });
});

describe('aboutDetail', () => {
  it('includes version and optional release date', () => {
    setLocale('zh-CN');
    expect(aboutDetail({ version: '2.2.3' })).toBe('版本：2.2.3');
    expect(aboutDetail({ version: '2.2.3', releaseDate: '2026-10-21' })).toBe('版本：2.2.3\n发布时间：2026年10月21日');
  });
});
