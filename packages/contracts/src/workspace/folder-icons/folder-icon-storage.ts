/**
 * Storage and retrieval for custom folder icons.
 * Persists by workspace-root + relative path.
 */

import type { FolderIconTheme, FolderIconVariant } from './folder-icon-definitions';

export interface CustomFolderIcon {
  theme: FolderIconTheme;
  variant: FolderIconVariant;
}

export interface FolderIconMapping {
  [relativePath: string]: CustomFolderIcon;
}

const STORAGE_KEY_PREFIX = 'easyview.workspace.folderIcons';

function storageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}.${btoa(workspaceRoot)}`;
}

export function getCustomFolderIcon(workspaceRoot: string, relativePath: string): CustomFolderIcon | null {
  try {
    const key = storageKey(workspaceRoot);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const mapping: FolderIconMapping = JSON.parse(stored);
    return mapping[relativePath] ?? null;
  } catch {
    return null;
  }
}

export function setCustomFolderIcon(
  workspaceRoot: string,
  relativePath: string,
  icon: CustomFolderIcon | null,
): void {
  try {
    const key = storageKey(workspaceRoot);
    const stored = localStorage.getItem(key);
    const mapping: FolderIconMapping = stored ? JSON.parse(stored) : {};
    
    if (icon === null) {
      delete mapping[relativePath];
    } else {
      mapping[relativePath] = icon;
    }
    
    localStorage.setItem(key, JSON.stringify(mapping));
  } catch (error) {
    console.error('[EasyView] Failed to save custom folder icon:', error);
  }
}

export function clearCustomFolderIcon(workspaceRoot: string, relativePath: string): void {
  setCustomFolderIcon(workspaceRoot, relativePath, null);
}
