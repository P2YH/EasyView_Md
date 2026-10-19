/** @vitest-environment node */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalWorkspaceGateway,
  rankWorkspaceSearchMatch,
  searchWorkspaceTree,
  WorkspaceTreeModel,
} from './workspace';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function workspace(files: string[]): Promise<WorkspaceTreeModel> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'easyview-search-'));
  tempDirectories.push(root);
  for (const file of files) {
    const target = path.join(root, file);
    if (file.endsWith('/')) await fs.mkdir(target, { recursive: true });
    else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, '');
    }
  }
  return new WorkspaceTreeModel(new LocalWorkspaceGateway([{ id: 'root', rootPath: root }]));
}

describe('rankWorkspaceSearchMatch', () => {
  it('matches case-insensitively, requires every term, and ranks exact and prefix matches first', () => {
    expect(rankWorkspaceSearchMatch('README.md', 'readme.md')).toBe(0);
    expect(rankWorkspaceSearchMatch('README.md', 'readme')).toBe(1);
    expect(rankWorkspaceSearchMatch('Readme-guide.md', 'read')).toBe(2);
    expect(rankWorkspaceSearchMatch('my-readme.md', 'readme')).toBe(3);
    expect(rankWorkspaceSearchMatch('design rules.md', 'rules design')).toBe(3);
    expect(rankWorkspaceSearchMatch('notes.md', 'readme')).toBeNull();
    expect(rankWorkspaceSearchMatch('notes.md', '   ')).toBeNull();
  });
});

describe('searchWorkspaceTree', () => {
  it('finds files and folders at any depth, skipping .git and node_modules', async () => {
    const model = await workspace([
      'docs/guide/Setup-Guide.md',
      'guide/',
      'notes.md',
      'node_modules/pkg/guide.md',
      '.git/guide',
    ]);
    const result = await searchWorkspaceTree(model, 'root', 'guide');
    expect(result.entries.map((entry) => [entry.relativePath, entry.kind])).toEqual([
      ['guide', 'directory'],
      ['docs/guide', 'directory'],
      ['docs/guide/Setup-Guide.md', 'file'],
    ]);
    expect(result.truncated).toBe(false);
  });

  it('honors dot-entry visibility and result limits', async () => {
    const model = await workspace(['.config/a.md', 'b/a.md', 'c/a.md']);
    expect((await searchWorkspaceTree(model, 'root', 'a.md', { showDotEntries: false })).entries
      .map((entry) => entry.relativePath)).toEqual(['b/a.md', 'c/a.md']);
    const limited = await searchWorkspaceTree(model, 'root', 'a.md', { maxResults: 1 });
    expect(limited.entries).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('returns nothing for a blank query', async () => {
    const model = await workspace(['a.md']);
    expect(await searchWorkspaceTree(model, 'root', '  ')).toEqual({ entries: [], truncated: false });
  });
});
