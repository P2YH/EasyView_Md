import { describe, expect, it } from 'vitest';
import { findHorizontalRuleLines } from './horizontal-rule';

describe('findHorizontalRuleLines', () => {
  it('recognizes ---, *** and ___ variants including spaced markers', () => {
    expect(findHorizontalRuleLines(['---', '', '***', '', '___', '', '- - -', '', '  * * * *', '', '-----'])).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('treats --- directly under paragraph text as a setext heading underline', () => {
    expect(findHorizontalRuleLines(['业务系统说明', '---', '', '---'])).toEqual([3]);
  });

  it('still draws *** and ___ under paragraph text, and --- under a heading', () => {
    expect(findHorizontalRuleLines(['text', '***', 'text', '___', '## 标题', '---'])).toEqual([1, 3, 5]);
  });

  it('ignores front matter delimiters', () => {
    expect(findHorizontalRuleLines(['---', 'title: x', '---', '', '---'])).toEqual([4]);
    expect(findHorizontalRuleLines(['<!-- easyview:settings {} -->', '---', 'title: x', '---', '', '---'])).toEqual([5]);
  });

  it('ignores lines inside fenced code blocks', () => {
    expect(findHorizontalRuleLines(['```', '---', '```', '~~~~', '***', '~~~~', '---'])).toEqual([6]);
  });

  it('rejects non-rules: too few markers, mixed markers, deep indent, table separators', () => {
    expect(findHorizontalRuleLines(['--', '', '-*-', '', '    ---', '', '| --- | --- |', '', '--- text'])).toEqual([]);
  });
});
