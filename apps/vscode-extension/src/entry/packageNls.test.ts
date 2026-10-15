import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const readJson = (name: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(root, name), 'utf8'));

describe('package.nls', () => {
  const manifestKeys = [...readFileSync(path.join(root, 'package.json'), 'utf8').matchAll(/"%([^"%]+)%"/g)].map((match) => match[1]);

  it.each(['package.nls.json', 'package.nls.zh-cn.json', 'package.nls.zh-tw.json'])('%s covers every manifest placeholder', (file) => {
    const bundle = readJson(file);
    expect(manifestKeys.length).toBeGreaterThan(0);
    expect(manifestKeys.filter((key) => typeof bundle[key] !== 'string' || !(bundle[key] as string).trim())).toEqual([]);
    expect(Object.keys(bundle).filter((key) => !manifestKeys.includes(key))).toEqual([]);
  });
});
