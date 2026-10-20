import path from 'node:path';
import { abbreviateHome } from '../workspace/recentFolders';

export const OPEN_FOLDER_FLAG = '--easyview-open-folder';
export const SHELL_RECENT_FOLDER_LIMIT = 3;

export interface RecentFolderShellItem {
  path: string;
  /** Folder name plus its home-abbreviated parent, e.g. "EasyView_Md — ~/GenAI". */
  label: string;
  /** Full path with the home directory shown as "~" (never the user name). */
  displayPath: string;
}

/** Builds the Dock menu / Jump List entries for the most recent folders. */
export function buildRecentFolderShellItems(folderPaths: readonly string[], homeDir: string, limit = SHELL_RECENT_FOLDER_LIMIT): RecentFolderShellItem[] {
  const seen = new Set<string>();
  const items: RecentFolderShellItem[] = [];
  for (const folderPath of folderPaths) {
    if (items.length >= limit) break;
    if (!path.isAbsolute(folderPath) || seen.has(folderPath)) continue;
    seen.add(folderPath);
    const name = path.basename(folderPath) || folderPath;
    const parent = abbreviateHome(path.dirname(folderPath), homeDir);
    const displayPath = abbreviateHome(folderPath, homeDir);
    items.push({ path: folderPath, label: parent === folderPath ? name : `${name} — ${parent}`, displayPath });
  }
  return items;
}

/** Reads `--easyview-open-folder <path>` (or `--easyview-open-folder=<path>`) from argv. */
export function folderArgumentFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let value: string | undefined;
    if (argument === OPEN_FOLDER_FLAG) value = argv[index + 1];
    else if (argument.startsWith(`${OPEN_FOLDER_FLAG}=`)) value = argument.slice(OPEN_FOLDER_FLAG.length + 1);
    if (value && path.isAbsolute(value)) return value;
  }
  return undefined;
}

/** Windows user-task argument string; undefined for paths that cannot be quoted safely. */
export function windowsOpenFolderArguments(folderPath: string): string | undefined {
  if (folderPath.includes('"') || /[\r\n]/.test(folderPath)) return undefined;
  // A trailing backslash would escape the closing quote in CommandLineToArgvW.
  return `${OPEN_FOLDER_FLAG} "${folderPath.replace(/\\+$/, '')}"`;
}
