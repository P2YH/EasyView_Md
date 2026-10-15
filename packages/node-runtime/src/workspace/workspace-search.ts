import { isWorkspaceDotEntryName, type WorkspaceEntry, type WorkspaceSearchResult } from '@easyview/contracts';
import type { WorkspaceTreeModel } from './workspace-tree-model';

export interface WorkspaceSearchOptions {
  /** Skip `.name` entries and do not descend into dot folders. */
  showDotEntries?: boolean;
  maxResults?: number;
  /** Bounds the walk on very large trees; the result is marked truncated when hit. */
  maxDirectories?: number;
}

/** Heavy generated folders that are never worth walking for a name search. */
export const WORKSPACE_SEARCH_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['.git', 'node_modules']);

const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_DIRECTORIES = 5_000;
const WALK_CONCURRENCY = 8;

/**
 * Lower is better; `null` means no match. Every whitespace-separated term must
 * appear in the name (case-insensitive).
 */
export function rankWorkspaceSearchMatch(name: string, query: string): number | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const lower = name.toLowerCase();
  if (!terms.every((term) => lower.includes(term))) return null;
  const whole = terms.join(' ');
  if (lower === whole) return 0;
  const stem = lower.replace(/\.[^.]+$/, '');
  if (stem === whole) return 1;
  if (lower.startsWith(terms[0])) return 2;
  return 3;
}

/** Breadth-first name search over the whole workspace tree. */
export async function searchWorkspaceTree(
  model: WorkspaceTreeModel,
  rootId: string,
  query: string,
  options: WorkspaceSearchOptions = {},
): Promise<WorkspaceSearchResult> {
  if (!query.trim()) return { entries: [], truncated: false };
  const showDotEntries = options.showDotEntries !== false;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
  const matches: Array<{ entry: WorkspaceEntry; rank: number }> = [];
  const queue: string[] = [''];
  let visited = 0;
  let truncated = false;

  const visit = async (directory: string): Promise<void> => {
    let children: readonly WorkspaceEntry[];
    try {
      children = await model.listChildren(rootId, directory);
    } catch {
      return;
    }
    for (const child of children) {
      if (!showDotEntries && isWorkspaceDotEntryName(child.name)) continue;
      const rank = rankWorkspaceSearchMatch(child.name, query);
      if (rank !== null) matches.push({ entry: child, rank });
      if (child.kind === 'directory' && !WORKSPACE_SEARCH_SKIPPED_DIRECTORIES.has(child.name)) {
        queue.push(child.relativePath);
      }
    }
  };

  while (queue.length > 0) {
    if (visited >= maxDirectories) {
      truncated = true;
      break;
    }
    const batch = queue.splice(0, Math.min(WALK_CONCURRENCY, maxDirectories - visited));
    visited += batch.length;
    await Promise.all(batch.map(visit));
  }

  matches.sort((a, b) => a.rank - b.rank
    || depth(a.entry.relativePath) - depth(b.entry.relativePath)
    || a.entry.relativePath.localeCompare(b.entry.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  if (matches.length > maxResults) truncated = true;
  return { entries: matches.slice(0, maxResults).map(({ entry }) => entry), truncated };
}

function depth(relativePath: string): number {
  return relativePath.split('/').length;
}
