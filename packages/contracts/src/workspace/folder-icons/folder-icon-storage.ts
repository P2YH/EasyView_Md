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

/** Latin1-safe base64 so Chinese / emoji workspace paths do not throw in btoa. */
function encodeKeyPart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function storageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}.${encodeKeyPart(workspaceRoot)}`;
}

/** Legacy key used before Unicode-safe encoding (ASCII-only roots). */
function legacyStorageKey(workspaceRoot: string): string | null {
  try {
    return `${STORAGE_KEY_PREFIX}.${btoa(workspaceRoot)}`;
  } catch {
    return null;
  }
}

function readMapping(key: string): FolderIconMapping {
  const stored = localStorage.getItem(key);
  if (!stored) return {};
  return JSON.parse(stored) as FolderIconMapping;
}

export function getCustomFolderIcon(workspaceRoot: string, relativePath: string): CustomFolderIcon | null {
  try {
    const key = storageKey(workspaceRoot);
    const mapping = readMapping(key);
    if (mapping[relativePath]) return mapping[relativePath] ?? null;

    // Migrate any ASCII mapping saved with the old btoa key.
    const legacy = legacyStorageKey(workspaceRoot);
    if (legacy && legacy !== key) {
      const legacyMapping = readMapping(legacy);
      if (legacyMapping[relativePath]) {
        localStorage.setItem(key, JSON.stringify(legacyMapping));
        localStorage.removeItem(legacy);
        return legacyMapping[relativePath] ?? null;
      }
    }
    return null;
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
    let mapping = readMapping(key);

    // Prefer merging from legacy key so ASCII saves are not lost on first Unicode-safe write.
    const legacy = legacyStorageKey(workspaceRoot);
    if (legacy && legacy !== key && !localStorage.getItem(key)) {
      mapping = { ...readMapping(legacy), ...mapping };
      localStorage.removeItem(legacy);
    }

    if (icon === null) {
      delete mapping[relativePath];
    } else {
      mapping[relativePath] = icon;
    }

    if (Object.keys(mapping).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(mapping));
  } catch (error) {
    console.error('[EasyView] Failed to save custom folder icon:', error);
  }
}

export function clearCustomFolderIcon(workspaceRoot: string, relativePath: string): void {
  setCustomFolderIcon(workspaceRoot, relativePath, null);
}
