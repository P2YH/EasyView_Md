import { describe, expect, it } from 'vitest';
import { isMarkdownFilePath, stripMarkdownExtension } from './markdown-file';

describe('markdown files', () => {
  it('treats Cursor .mdc rules as Markdown', () => {
    for (const name of ['a.md', 'b.MARKDOWN', 'c.mdx', '.cursor/rules/d.mdc']) expect(isMarkdownFilePath(name)).toBe(true);
    for (const name of ['e.mdcx', 'f.txt', 'mdc', 'g.md.bak']) expect(isMarkdownFilePath(name)).toBe(false);
  });

  it('strips only the Markdown suffix', () => {
    expect(stripMarkdownExtension('release-monitoring.mdc')).toBe('release-monitoring');
    expect(stripMarkdownExtension('notes.v2.md')).toBe('notes.v2');
    expect(stripMarkdownExtension('data.json')).toBe('data.json');
  });
});
