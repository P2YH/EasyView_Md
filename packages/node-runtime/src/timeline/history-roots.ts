import path from 'node:path';
import os from 'node:os';
import { readdir } from 'node:fs/promises';
import type { TimelineSource } from '@easyview/contracts';
export interface HostHistoryRoot { source: Extract<TimelineSource, 'vscode' | 'cursor'>; path: string; error?: string }
/** Inspect only known product/profile directories, never the history library itself. */
export async function discoverHostHistoryRoots(currentUserDataPath?: string, currentSource?: HostHistoryRoot['source']): Promise<HostHistoryRoot[]> {
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32' ? process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming')
    : process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  const products: Array<[HostHistoryRoot['source'], string]> = [
    ['vscode', path.join(base, 'Code')], ['cursor', path.join(base, 'Cursor')],
  ];
  if (currentUserDataPath) products.push([currentSource ?? (/cursor/i.test(currentUserDataPath) ? 'cursor' : 'vscode'), currentUserDataPath]);
  const roots: HostHistoryRoot[] = [];
  for (const [source, product] of products) {
    roots.push({ source, path: path.join(product, 'User/History') });
    try {
      for (const profile of await readdir(path.join(product, 'User/profiles'), { withFileTypes: true })) {
        if (profile.isDirectory()) roots.push({ source, path: path.join(product, 'User/profiles', profile.name, 'History') });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') roots.push({ source, path: path.join(product, 'User/profiles'), error: error instanceof Error ? error.message : String(error) }); }
  }
  return roots.filter((root, i) => roots.findIndex((candidate) => candidate.path === root.path) === i);
}
/** VS Code's string-hash folder identity (MIT: microsoft/vscode, base/common/hash.ts). */
export function hostHistoryHash(uri: string): string {
  let hash = 149417;
  for (let i = 0; i < uri.length; i++) hash = ((hash << 5) - hash + uri.charCodeAt(i)) | 0;
  return hash.toString(16);
}
/** Match vscode-uri's encoded file URI, including lowercase Windows drives and escaped colons. */
export function hostHistoryUri(filePath: string): string {
  let resourcePath = filePath;
  let authority = '';
  if (/^[a-z]:[\\/]/i.test(filePath)) resourcePath = `/${filePath[0].toLowerCase()}${filePath.slice(1).replace(/\\/g, '/')}`;
  else if (filePath.startsWith('\\\\')) { const parts = filePath.slice(2).replace(/\\/g,'/').split('/'); authority = parts.shift()!.toLowerCase(); resourcePath = '/' + parts.join('/'); }
  const encoded = encodeURIComponent(resourcePath).replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');
  return `file://${authority}${encoded}`;
}
