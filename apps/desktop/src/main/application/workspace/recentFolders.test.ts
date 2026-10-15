import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abbreviateHome, RecentFolderStore } from './recentFolders';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'easyview-recent-folders-')));
  temporaryDirectories.push(directory);
  return directory;
}

describe('RecentFolderStore', () => {
  it('keeps the most recent folder first without duplicates and persists across instances', async () => {
    const userData = await temporaryDirectory();
    const first = path.join(userData, 'first');
    const second = path.join(userData, 'second');
    await fs.mkdir(first);
    await fs.mkdir(second);

    const store = new RecentFolderStore(userData, userData);
    await store.remember(first);
    await store.remember(second);
    await store.remember(first);
    expect(await store.paths()).toEqual([first, second]);

    const reloaded = new RecentFolderStore(userData, userData);
    const listed = await reloaded.list();
    expect(listed.map((folder) => folder.path)).toEqual([first, second]);
    expect(listed[0]).toMatchObject({ name: 'first', displayPath: '~', exists: true });
  });

  it('flags missing folders and forgets them on request', async () => {
    const userData = await temporaryDirectory();
    const missing = path.join(userData, 'gone');
    const store = new RecentFolderStore(userData, userData);
    await store.remember(missing);
    expect((await store.list())[0]?.exists).toBe(false);

    await store.forget(missing);
    expect(await store.paths()).toEqual([]);
    expect(store.snapshot()).toEqual([]);
  });

  it('ignores a corrupt or non-array state file', async () => {
    const userData = await temporaryDirectory();
    await fs.writeFile(path.join(userData, 'recent-folders.json'), '{"oops":true}');
    expect(await new RecentFolderStore(userData).paths()).toEqual([]);
  });
});

describe('abbreviateHome', () => {
  it('shortens paths inside the home directory only', () => {
    const home = path.join(path.sep, 'Users', 'me');
    expect(abbreviateHome(home, home)).toBe('~');
    expect(abbreviateHome(path.join(home, 'GAFile'), home)).toBe(`~${path.sep}GAFile`);
    expect(abbreviateHome(path.join(path.sep, 'Users', 'meow'), home)).toBe(path.join(path.sep, 'Users', 'meow'));
  });
});
