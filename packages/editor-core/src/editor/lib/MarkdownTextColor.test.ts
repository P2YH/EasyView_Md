/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';

import { docToMarkdown } from './MarkdownSerializer';
import { createParser, parseMarkdown } from './MarkdownParser';

const parser = createParser();

function inlineMarks(markdown: string): Array<{ text: string; marks: string[] }> {
  const doc = parseMarkdown(markdown, parser)!;
  const result: Array<{ text: string; marks: string[] }> = [];
  doc.descendants((node) => {
    if (node.isText) {
      result.push({
        text: node.text!,
        marks: node.marks.map((mark) => (mark.attrs.color ? `${mark.type.name}:${mark.attrs.color}` : mark.type.name)),
      });
    }
  });
  return result;
}

describe('text color markdown round-trip', () => {
  it('parses a highlighted colored span and saves it unchanged', () => {
    const markdown = '文字。==<span style="color: #ea580c">【批注 张三 2026-10-10 10:25：内容】</span>==';
    expect(inlineMarks(markdown)).toEqual([
      { text: '文字。', marks: [] },
      { text: '【批注 张三 2026-10-10 10:25：内容】', marks: ['highlight', 'text_color:#ea580c'] },
    ]);
    expect(docToMarkdown(parseMarkdown(markdown, parser)!).trim()).toBe(markdown);
  });

  it('keeps nested inline marks inside highlights', () => {
    expect(inlineMarks('==a **b**==')).toEqual([
      { text: 'a ', marks: ['highlight'] },
      { text: 'b', marks: ['strong', 'highlight'] },
    ]);
  });

  it('pairs color spans correctly inside unrelated spans', () => {
    expect(inlineMarks('a<span class="mark">b<span style="color: red">c</span>d</span>e')).toEqual([
      { text: 'ab', marks: [] },
      { text: 'c', marks: ['text_color:red'] },
      { text: 'de', marks: [] },
    ]);
  });
});
