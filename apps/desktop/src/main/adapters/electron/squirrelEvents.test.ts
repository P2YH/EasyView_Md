import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { quit: vi.fn() } }));

const { fileAssociationRegistryCommands, fileAssociationRemovalCommands, MARKDOWN_PROG_ID } = await import('./squirrelEvents');

const stub = 'C:\\Users\\me\\AppData\\Local\\easyview_md\\EasyView_Md.exe';

describe('Windows Markdown file association', () => {
  it('registers the update-stable stub under Open with for every Markdown extension', () => {
    const commands = fileAssociationRegistryCommands(stub);
    expect(commands).toContainEqual([
      'add', `HKCU\\Software\\Classes\\${MARKDOWN_PROG_ID}\\shell\\open\\command`, '/ve', '/d', `"${stub}" "%1"`, '/f',
    ]);
    expect(commands).toContainEqual([
      'add', 'HKCU\\Software\\Classes\\Applications\\EasyView_Md.exe\\shell\\open\\command', '/ve', '/d', `"${stub}" "%1"`, '/f',
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

  it('removes only the keys and values it added', () => {
    const commands = fileAssociationRemovalCommands(stub);
    expect(commands).toContainEqual(['delete', `HKCU\\Software\\Classes\\${MARKDOWN_PROG_ID}`, '/f']);
    expect(commands).toContainEqual(['delete', 'HKCU\\Software\\Classes\\Applications\\EasyView_Md.exe', '/f']);
    expect(commands).toContainEqual(['delete', 'HKCU\\Software\\Classes\\.md\\OpenWithProgids', '/v', MARKDOWN_PROG_ID, '/f']);
    expect(commands.some((args) => args[1] === 'HKCU\\Software\\Classes\\.md' && args.length === 3)).toBe(false);
  });
});
