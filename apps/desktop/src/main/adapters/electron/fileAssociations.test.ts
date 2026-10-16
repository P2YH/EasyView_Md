import { describe, expect, it } from 'vitest';
import { fileAssociationRegistryCommands, MARKDOWN_PROG_ID, registeredOpenTarget } from './fileAssociations';

const exe = 'D:\\Apps\\EasyView_Md\\EasyView_Md.exe';

describe('Windows Markdown file association', () => {
  it('registers the installed executable under Open with for every Markdown extension', () => {
    const commands = fileAssociationRegistryCommands(exe);
    expect(commands).toContainEqual([
      'add', `HKCU\\Software\\Classes\\${MARKDOWN_PROG_ID}\\shell\\open\\command`, '/ve', '/d', `"${exe}" "%1"`, '/f',
    ]);
    expect(commands).toContainEqual([
      'add', 'HKCU\\Software\\Classes\\Applications\\EasyView_Md.exe\\shell\\open\\command', '/ve', '/d', `"${exe}" "%1"`, '/f',
    ]);
    for (const extension of ['.md', '.markdown', '.mdx']) {
      expect(commands).toContainEqual([
        'add', `HKCU\\Software\\Classes\\${extension}\\OpenWithProgids`, '/v', MARKDOWN_PROG_ID, '/d', '', '/f',
      ]);
      expect(commands).toContainEqual([
        'add', 'HKCU\\Software\\Classes\\Applications\\EasyView_Md.exe\\SupportedTypes', '/v', extension, '/d', '', '/f',
      ]);
    }
    expect(commands.every((args) => args[1].startsWith('HKCU\\'))).toBe(true);
    expect(commands.some((args) => args[1] === 'HKCU\\Software\\Classes\\.md' && args.includes('/ve'))).toBe(false);
  });

  it('can target the machine-wide classes root', () => {
    expect(fileAssociationRegistryCommands(exe, 'HKLM').every((args) => args[1].startsWith('HKLM\\Software\\Classes\\'))).toBe(true);
  });

  it('reads the registered executable from reg query output in any UI language', () => {
    const key = `HKEY_CURRENT_USER\\Software\\Classes\\${MARKDOWN_PROG_ID}\\shell\\open\\command`;
    expect(registeredOpenTarget(`\r\n${key}\r\n    (Default)    REG_SZ    "${exe}" "%1"\r\n`)).toBe(exe);
    expect(registeredOpenTarget(`\r\n${key}\r\n    (默认)    REG_SZ    "${exe}" "%1"\r\n`)).toBe(exe);
    expect(registeredOpenTarget(`\r\n${key}\r\n    (Default)    REG_SZ    \r\n`)).toBeUndefined();
  });
});
