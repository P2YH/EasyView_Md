import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const CLASSES_ROOT = 'HKCU\\Software\\Classes';
export const MARKDOWN_PROG_ID = 'EasyViewMd.Markdown';
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const;

/**
 * `reg.exe` argument lists that list EasyView_Md under Explorer's "Open with" for Markdown files.
 * `exePath` must be the Squirrel stub (install root), which survives updates, not the versioned `app-x.y.z` binary.
 * Default handlers are never overwritten; the user picks EasyView_Md explicitly.
 */
export function fileAssociationRegistryCommands(exePath: string): string[][] {
  const exeName = path.win32.basename(exePath);
  const openCommand = `"${exePath}" "%1"`;
  const progId = `${CLASSES_ROOT}\\${MARKDOWN_PROG_ID}`;
  const application = `${CLASSES_ROOT}\\Applications\\${exeName}`;
  return [
    ['add', progId, '/ve', '/d', 'Markdown', '/f'],
    ['add', `${progId}\\DefaultIcon`, '/ve', '/d', `"${exePath}",0`, '/f'],
    ['add', `${progId}\\shell\\open\\command`, '/ve', '/d', openCommand, '/f'],
    ['add', application, '/v', 'FriendlyAppName', '/d', 'EasyView_Md', '/f'],
    ['add', `${application}\\shell\\open\\command`, '/ve', '/d', openCommand, '/f'],
    ...MARKDOWN_EXTENSIONS.flatMap((extension) => [
      ['add', `${CLASSES_ROOT}\\${extension}\\OpenWithProgids`, '/v', MARKDOWN_PROG_ID, '/d', '', '/f'],
      ['add', `${application}\\SupportedTypes`, '/v', extension, '/d', '', '/f'],
    ]),
  ];
}

export function fileAssociationRemovalCommands(exePath: string): string[][] {
  const exeName = path.win32.basename(exePath);
  return [
    ['delete', `${CLASSES_ROOT}\\${MARKDOWN_PROG_ID}`, '/f'],
    ['delete', `${CLASSES_ROOT}\\Applications\\${exeName}`, '/f'],
    ...MARKDOWN_EXTENSIONS.map((extension) => (
      ['delete', `${CLASSES_ROOT}\\${extension}\\OpenWithProgids`, '/v', MARKDOWN_PROG_ID, '/f']
    )),
  ];
}

function runRegistry(commands: string[][]): void {
  for (const args of commands) {
    const result = spawnSync('reg.exe', args, { windowsHide: true });
    if (result.status !== 0) {
      console.warn(`[EasyView_Md] reg ${args.slice(0, 2).join(' ')} failed:`, result.stderr?.toString() ?? result.error);
    }
  }
}

/**
 * Start Menu shortcut created by releases built without win32metadata.CompanyName (Electron's default
 * "GitHub, Inc."). Squirrel only manages the folder of the current company name, so the old one is removed here.
 */
export function legacyStartMenuShortcut(appDataDir: string, exeName: string): { folder: string; shortcut: string } {
  const folder = path.win32.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'GitHub, Inc');
  return { folder, shortcut: path.win32.join(folder, `${path.win32.parse(exeName).name}.lnk`) };
}

function removeLegacyStartMenuShortcut(exeName: string): void {
  const { folder, shortcut } = legacyStartMenuShortcut(app.getPath('appData'), exeName);
  try {
    rmSync(shortcut, { force: true });
    if (existsSync(folder) && readdirSync(folder).length === 0) rmdirSync(folder);
  } catch (error) {
    console.warn('[EasyView_Md] Failed to remove legacy Start Menu shortcut:', error);
  }
}

function runUpdateExe(args: string[], done: () => void): void {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  spawn(updateExe, args, { detached: true }).on('close', done).on('error', done);
}

/**
 * Handles the Squirrel.Windows install / update / uninstall hooks (shortcuts + file associations)
 * and quits. Returns true when the current launch was such a hook and the app must not start.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const command = process.argv[1];
  const exeName = path.basename(process.execPath);
  const stubPath = path.resolve(path.dirname(process.execPath), '..', exeName);
  if (command === '--squirrel-install' || command === '--squirrel-updated') {
    runRegistry(fileAssociationRegistryCommands(stubPath));
    removeLegacyStartMenuShortcut(exeName);
    runUpdateExe([`--createShortcut=${exeName}`], () => app.quit());
    return true;
  }
  if (command === '--squirrel-uninstall') {
    runRegistry(fileAssociationRemovalCommands(stubPath));
    removeLegacyStartMenuShortcut(exeName);
    runUpdateExe([`--removeShortcut=${exeName}`], () => app.quit());
    return true;
  }
  if (command === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  return false;
}
