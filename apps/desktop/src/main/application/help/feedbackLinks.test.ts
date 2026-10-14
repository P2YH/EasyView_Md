import { describe, expect, it } from 'vitest';
import { buildFeedbackMailto, buildIssueUrl } from './feedbackLinks';

const env = { appVersion: '2.0.5', platform: 'darwin', osVersion: '15.1', arch: 'arm64', electronVersion: '33.0.0' };

describe('feedbackLinks', () => {
  it('builds a prefilled GitHub issue URL using the bug template', () => {
    const url = new URL(buildIssueUrl(env));
    expect(url.origin + url.pathname).toBe('https://github.com/tiantianmanmanzou/EasyView_Md/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    const environment = url.searchParams.get('environment') ?? '';
    expect(environment).toContain('EasyView: 2.0.5');
    expect(environment).toContain('OS: macOS 15.1');
    expect(environment).toContain('Arch: arm64');
  });

  it('builds a mailto link with subject and environment body', () => {
    const link = buildFeedbackMailto(env);
    expect(link.startsWith('mailto:zalmanzxy@gmail.com?')).toBe(true);
    const params = new URLSearchParams(link.split('?')[1]);
    expect(params.get('subject')).toContain('v2.0.5');
    expect(params.get('body')).toContain('Arch: arm64');
    expect(link).not.toContain('+');
  });
});

describe('feedbackLinks logs path', () => {
  it('includes logs directory when provided', () => {
    const url = new URL(buildIssueUrl({ ...env, logsDirectory: '/tmp/logs' }));
    expect(url.searchParams.get('environment')).toContain('Logs: /tmp/logs');
  });
});

import { anonymizePath } from './feedbackLinks';

describe('anonymizePath', () => {
  it('replaces macOS/Linux home with ~', () => {
    expect(anonymizePath('/Users/zhangxy/Library/Logs/EasyView_Md', { platform: 'darwin', homeDir: '/Users/zhangxy' })).toBe('~/Library/Logs/EasyView_Md');
    expect(anonymizePath('/home/bob/.config/x/logs', { platform: 'linux', homeDir: '/home/bob/' })).toBe('~/.config/x/logs');
    expect(anonymizePath('/Users/zhangxyz/a', { platform: 'darwin', homeDir: '/Users/zhangxy' })).toBe('/Users/<user>/a');
  });

  it('replaces Windows APPDATA / USERPROFILE', () => {
    const ctx = { platform: 'win32', homeDir: 'C:\\Users\\Bob', appData: 'C:\\Users\\Bob\\AppData\\Roaming', userProfile: 'C:\\Users\\Bob' };
    expect(anonymizePath('C:\\Users\\Bob\\AppData\\Roaming\\EasyView_Md\\logs', ctx)).toBe('%APPDATA%\\EasyView_Md\\logs');
    expect(anonymizePath('c:\\users\\bob\\Desktop', ctx)).toBe('%USERPROFILE%\\Desktop');
    expect(anonymizePath('C:\\Users\\Alice\\x', { platform: 'win32', homeDir: '' })).toBe('C:\\Users\\<user>\\x');
  });

  it('keeps username out of generated links', () => {
    const logs = anonymizePath('/Users/zhangxy/Library/Logs/EasyView_Md', { platform: 'darwin', homeDir: '/Users/zhangxy' });
    const e = { ...env, logsDirectory: logs };
    expect(decodeURIComponent(buildIssueUrl(e))).not.toContain('zhangxy');
    expect(decodeURIComponent(buildFeedbackMailto(e))).not.toContain('zhangxy');
    console.log(new URL(buildIssueUrl(e)).searchParams.get('environment'));
  });
});
