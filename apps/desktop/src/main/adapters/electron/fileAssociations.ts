import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { windowsInstallKind } from '../../application/update/updateCore';

const execFileAsync = promisify(execFile);

export const MARKDOWN_PROG_ID = 'EasyViewMd.Markdown';
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const;

const classesRoot = (root: 'HKCU' | 'HKLM') => `${root}\\Software\\Classes`;
const openCommandKey = (root: 'HKCU' | 'HKLM') => `${classesRoot(root)}\\${MARKDOWN_PROG_ID}\\shell\\open\\command`;

/**
 * `reg.exe` argument lists that list EasyView_Md under Explorer's "Open with" for Markdown files.
 * Default handlers are never overwritten; the user picks EasyView_Md explicitly.
 * The installer writes the same keys (build/installer.nsh).
 */
export function fileAssociationRegistryCommands(exePath: string, root: 'HKCU' | 'HKLM' = 'HKCU'): string[][] {
  const exeName = exePath.replace(/^.*[\\/]/, '');
  const openCommand = `"${exePath}" "%1"`;
  const progId = `${classesRoot(root)}\\${MARKDOWN_PROG_ID}`;
  const application = `${classesRoot(root)}\\Applications\\${exeName}`;
  return [
    ['add', progId, '/ve', '/d', 'Markdown', '/f'],
    ['add', `${progId}\\DefaultIcon`, '/ve', '/d', `"${exePath}",0`, '/f'],
    ['add', `${progId}\\shell\\open\\command`, '/ve', '/d', openCommand, '/f'],
    ['add', application, '/v', 'FriendlyAppName', '/d', 'EasyView_Md', '/f'],
    ['add', `${application}\\shell\\open\\command`, '/ve', '/d', openCommand, '/f'],
    ...MARKDOWN_EXTENSIONS.flatMap((extension) => [
      ['add', `${classesRoot(root)}\\${extension}\\OpenWithProgids`, '/v', MARKDOWN_PROG_ID, '/d', '', '/f'],
      ['add', `${application}\\SupportedTypes`, '/v', extension, '/d', '', '/f'],
    ]),
  ];
}

/** Executable registered in `reg query <ProgId>\shell\open\command /ve` output, if any. */
export function registeredOpenTarget(regQueryOutput: string): string | undefined {
  return /REG_(?:EXPAND_)?SZ\s+"([^"]+)"/.exec(regQueryOutput)?.[1];
}

async function registeredTarget(root: 'HKCU' | 'HKLM'): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', openCommandKey(root), '/ve'], { windowsHide: true });
    return registeredOpenTarget(stdout);
  } catch {
    return undefined;
  }
}

/**
 * Restores the "Open with" entry of an installed (NSIS) copy when it is missing or points at a removed
 * executable, e.g. after uninstalling an old Squirrel copy that shared the per-user keys.
 */
export async function ensureOpenWithRegistration(): Promise<void> {
  if (process.platform !== 'win32' || process.windowsStore) return;
  if (windowsInstallKind(process.execPath, existsSync) !== 'nsis') return;
  for (const root of ['HKCU', 'HKLM'] as const) {
    const target = await registeredTarget(root);
    if (target && existsSync(target)) return;
  }
  for (const args of fileAssociationRegistryCommands(process.execPath)) {
    try {
      await execFileAsync('reg.exe', args, { windowsHide: true });
    } catch (error) {
      console.warn(`[EasyView_Md] reg ${args.slice(0, 2).join(' ')} failed:`, error);
      return;
    }
  }
}
