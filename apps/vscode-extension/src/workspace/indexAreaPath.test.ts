import { describe, expect, it } from 'vitest';
import { indexAreaRelativePath } from './indexAreaPath';

describe('indexAreaRelativePath', () => {
  const root = '/Users/zhangxy/GAFile/数运平台';
  it('resolves Chinese paths under the root', () => {
    expect(indexAreaRelativePath(root, `${root}/功能设计/数据安全能力运营/数据安全能力功能设计.md`))
      .toBe('功能设计/数据安全能力运营/数据安全能力功能设计.md');
  });
  it('tolerates NFD vs NFC and trailing slashes', () => {
    const nfdRoot = '/tmp/Café/'.normalize('NFD');
    expect(indexAreaRelativePath(nfdRoot, '/tmp/Café/文档/résumé.md'.normalize('NFC'))).toBe('文档/résumé.md');
  });
  it('matches case-insensitively when requested', () => {
    expect(indexAreaRelativePath('/Users/A/Docs', '/users/a/docs/Readme.md', { caseInsensitive: true })).toBe('Readme.md');
    expect(indexAreaRelativePath('/Users/A/Docs', '/users/a/docs/Readme.md')).toBeUndefined();
  });
  it('rejects files outside the root', () => {
    expect(indexAreaRelativePath(root, '/Users/zhangxy/GAFile/其他/a.md')).toBeUndefined();
  });
});
