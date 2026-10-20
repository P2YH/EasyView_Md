import { describe, expect, it } from 'vitest';
import { buildRecentFolderShellItems, folderArgumentFromArgv, windowsOpenFolderArguments } from './recentFolderShell';

describe('buildRecentFolderShellItems', () => {
  it('keeps the 3 most recent, deduped, with ~ instead of the user name', () => {
    const items = buildRecentFolderShellItems(
      ['/Users/zhangxy/GenAI/EasyView_Md', '/Users/zhangxy/GenAI/EasyView_Md', 'relative', '/Users/zhangxy/Docs', '/opt/data', '/Users/zhangxy/four'],
      '/Users/zhangxy',
    );
    expect(items.map((item) => item.label)).toEqual(['EasyView_Md — ~/GenAI', 'Docs — ~', 'data — /opt']);
    expect(items[0]).toMatchObject({ path: '/Users/zhangxy/GenAI/EasyView_Md', displayPath: '~/GenAI/EasyView_Md' });
    expect(items.some((item) => item.label.includes('zhangxy') || item.displayPath.includes('zhangxy'))).toBe(false);
  });
  it('returns nothing for empty input and respects the limit', () => {
    expect(buildRecentFolderShellItems([], '/Users/a')).toEqual([]);
    expect(buildRecentFolderShellItems(['/a', '/b'], '/Users/a', 1)).toHaveLength(1);
  });
});

describe('folderArgumentFromArgv', () => {
  it('parses both flag forms and ignores relative paths', () => {
    expect(folderArgumentFromArgv(['app', '--easyview-open-folder', '/x/y'])).toBe('/x/y');
    expect(folderArgumentFromArgv(['app', '--easyview-open-folder=/x/z'])).toBe('/x/z');
    expect(folderArgumentFromArgv(['app', '--easyview-open-folder', 'rel'])).toBeUndefined();
    expect(folderArgumentFromArgv(['app', '/x/doc.md'])).toBeUndefined();
  });
});

describe('windowsOpenFolderArguments', () => {
  it('quotes paths and rejects unsafe ones', () => {
    expect(windowsOpenFolderArguments('C:\\Users\\Bob\\My Notes\\')).toBe('--easyview-open-folder "C:\\Users\\Bob\\My Notes"');
    expect(windowsOpenFolderArguments('C:\\a"b')).toBeUndefined();
  });
});
