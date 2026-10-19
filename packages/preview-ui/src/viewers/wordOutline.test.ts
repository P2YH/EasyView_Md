/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  buildWordOutlineTree,
  defaultCollapsed,
  extractWordHeadings,
  findActiveHeading,
  headingLevelFromStyleName,
  headingNumberKind,
  inferWordHeadings,
  readDocxParagraphSamples,
  readStyleOutlineLevels,
  visibleAncestor,
  visibleWordOutlineRows,
  type WordOutlineHeading,
  type WordParagraphSample,
} from './wordOutline';

const body = (text = '这是一段足够长的正文内容，用于确定正文字号，它不会被识别为标题。', size = 10.5): WordParagraphSample =>
  ({ text, styleLevel: null, bold: false, fontSize: size });
const heading = (level: number, text: string, index = 0): WordOutlineHeading => ({ level, text, inferred: false, index });

describe('heading style names', () => {
  it('reads English, Chinese and slugged heading styles', () => {
    expect(headingLevelFromStyleName('Heading1')).toBe(0);
    expect(headingLevelFromStyleName('heading 2')).toBe(1);
    expect(headingLevelFromStyleName('heading-3')).toBe(2);
    expect(headingLevelFromStyleName('标题 1')).toBe(0);
    expect(headingLevelFromStyleName('标题-4')).toBe(3);
    expect(headingLevelFromStyleName('normal')).toBeNull();
    expect(headingLevelFromStyleName('1')).toBeNull();
    expect(headingLevelFromStyleName('heading 10')).toBeNull();
  });
});

describe('heading numbering', () => {
  it('recognises Chinese and decimal numbering', () => {
    expect(headingNumberKind('第一章 总则')).toBe('chapter');
    expect(headingNumberKind('第12节 范围')).toBe('section');
    expect(headingNumberKind('一、基本要求')).toBe('cn-enum');
    expect(headingNumberKind('（二）具体措施')).toBe('cn-paren');
    expect(headingNumberKind('1.1 适用范围')).toBe('decimal-2');
    expect(headingNumberKind('2.3.4 细则')).toBe('decimal-3');
    expect(headingNumberKind('3 总体设计')).toBe('decimal-1');
    expect(headingNumberKind('Chapter 4 Results')).toBe('chapter');
    expect(headingNumberKind('2026 年工作计划')).toBeNull();
    expect(headingNumberKind('3.14159 是圆周率')).toBeNull();
    expect(headingNumberKind('普通段落')).toBeNull();
  });
});

describe('extractWordHeadings', () => {
  it('prefers styled headings and keeps their levels', () => {
    const result = extractWordHeadings([
      { text: '第一章 项目背景', styleLevel: 0, bold: true, fontSize: 22 },
      body(),
      { text: ' 1.1 范围 ', styleLevel: 1, bold: true, fontSize: 16 },
      { text: '   ', styleLevel: 1, bold: false, fontSize: null },
      { text: '第二章 加粗但未使用样式', styleLevel: null, bold: true, fontSize: 22 },
    ]);
    expect(result).toEqual([
      { level: 1, text: '第一章 项目背景', inferred: false, index: 0 },
      { level: 2, text: '1.1 范围', inferred: false, index: 2 },
    ]);
  });

  it('infers numbered and large bold titles when no heading style is used', () => {
    const result = inferWordHeadings([
      { text: '数据安全管理办法', styleLevel: null, bold: true, fontSize: 18 },
      body(), body(),
      { text: '第一章 总则', styleLevel: null, bold: true, fontSize: 14 },
      body(),
      { text: '一、基本要求', styleLevel: null, bold: false, fontSize: 10.5 },
      body(),
      { text: '1.1 适用范围', styleLevel: null, bold: false, fontSize: 10.5 },
      body(),
      { text: '注意：本段只是加粗的强调。', styleLevel: null, bold: true, fontSize: 10.5 },
      { text: '1. 这是一个普通的编号列表项，内容比较长，长度超过了标题的合理范围，因此不应被识别为标题。', styleLevel: null, bold: false, fontSize: 10.5 },
      { text: '第二章 组织与职责', styleLevel: null, bold: true, fontSize: 14 },
      body(),
      { text: '1.2 具体措施', styleLevel: null, bold: false, fontSize: 10.5 },
      body(),
    ]);
    expect(result.map(h => [h.level, h.text, h.inferred])).toEqual([
      [1, '数据安全管理办法', true],
      [2, '第一章 总则', true],
      [3, '一、基本要求', true],
      [4, '1.1 适用范围', true],
      [2, '第二章 组织与职责', true],
      [4, '1.2 具体措施', true],
    ]);
  });

  it('orders decimal depths and sizes regardless of which appears first', () => {
    const result = inferWordHeadings([
      { text: '1.1 先出现的二级', styleLevel: null, bold: true, fontSize: 12 },
      body(),
      { text: '2 一级', styleLevel: null, bold: true, fontSize: 12 },
      body(),
      { text: '2.1 二级', styleLevel: null, bold: true, fontSize: 12 },
      body(),
    ]);
    expect(result.map(h => h.level)).toEqual([2, 1, 2]);
  });

  it('rejects numbered lists, sentences, excluded paragraphs and lone guesses', () => {
    const list = ['一、准备材料', '二、提交申请', '三、等待审核', '四、领取结果'].map(text => ({ text, styleLevel: null, bold: false, fontSize: 10.5 }));
    expect(inferWordHeadings([body(), ...list, body()])).toEqual([]);
    expect(inferWordHeadings([
      body(),
      { text: '第一章 总则。', styleLevel: null, bold: true, fontSize: 14 },
      { text: '第二章 表格里的标题', styleLevel: null, bold: true, fontSize: 14, excluded: true },
      { text: '第三章 唯一的候选', styleLevel: null, bold: true, fontSize: 14 },
      { text: '第四章 目录行\t12', styleLevel: null, bold: true, fontSize: 14 },
      { text: '第五章 目录行……………34', styleLevel: null, bold: true, fontSize: 14 },
      body(),
    ])).toEqual([]);
  });
});

describe('outline tree', () => {
  const headings = [
    heading(1, 'A'), heading(2, 'A.1'), heading(3, 'A.1.a'), heading(2, 'A.2'),
    heading(1, 'B'), heading(3, 'B.x'), heading(2, 'B.1'),
  ];

  it('nests by level and tolerates level jumps', () => {
    const nodes = buildWordOutlineTree(headings);
    expect(nodes.map(n => [n.heading.text, n.depth, n.parent])).toEqual([
      ['A', 0, null], ['A.1', 1, 0], ['A.1.a', 2, 1], ['A.2', 1, 0],
      ['B', 0, null], ['B.x', 1, 4], ['B.1', 1, 4],
    ]);
  });

  it('opens two levels deep by default and maps hidden headings to their visible ancestor', () => {
    const nodes = buildWordOutlineTree(headings);
    const collapsed = defaultCollapsed(nodes);
    expect([...collapsed]).toEqual([1]);
    const rows = visibleWordOutlineRows(nodes, collapsed);
    expect(rows.map(r => r.node.heading.text)).toEqual(['A', 'A.1', 'A.2', 'B', 'B.x', 'B.1']);
    expect(rows[1]).toMatchObject({ hasChildren: true, expanded: false });
    expect(visibleAncestor(nodes, collapsed, 2)).toBe(1);
    const allCollapsed = new Set([0, 1, 4]);
    expect(visibleWordOutlineRows(nodes, allCollapsed).map(r => r.node.heading.text)).toEqual(['A', 'B']);
    expect(visibleAncestor(nodes, allCollapsed, 2)).toBe(0);
  });
});

describe('findActiveHeading', () => {
  it('binary-searches the last heading above the offset and skips unknown tops', () => {
    const tops = [0, 100, null, 300, 400];
    expect(findActiveHeading(tops, -5)).toBe(-1);
    expect(findActiveHeading(tops, 0)).toBe(0);
    expect(findActiveHeading(tops, 250)).toBe(1);
    expect(findActiveHeading(tops, 300)).toBe(3);
    expect(findActiveHeading(tops, 10_000)).toBe(4);
    expect(findActiveHeading([], 10)).toBe(-1);
    const many = Array.from({ length: 5000 }, (_, i) => i * 10);
    expect(findActiveHeading(many, 12_345)).toBe(1234);
  });
});

describe('OOXML reader', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const styles = `<w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="MyTitle"><w:name w:val="My Title"/><w:basedOn w:val="2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
  </w:styles>`;
  const p = (style: string | null, text: string, extra = '') =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const documentXml = `<w:document ${W}><w:body>
    ${p('1', '第一章 背景')}
    ${p('MyTitle', '继承二级')}
    ${p('Heading3', 'Third')}
    ${p(null, 'Direct', '<w:outlineLvl w:val="2"/>')}
    ${p(null, 'Body text')}
    <w:tbl><w:tr><w:tc>${p(null, '表格')}</w:tc></w:tr></w:tbl>
  </w:body></w:document>`;

  it('resolves style outline levels through basedOn and style names', () => {
    const levels = readStyleOutlineLevels(styles);
    expect(levels.get('1')).toBe(0);
    expect(levels.get('2')).toBe(1);
    expect(levels.get('MyTitle')).toBe(1);
    expect(levels.get('Heading3')).toBe(2);
    expect(levels.has('a')).toBe(false);
  });

  it('reads paragraphs with levels, formatting and table exclusion', () => {
    const samples = readDocxParagraphSamples(documentXml, readStyleOutlineLevels(styles));
    expect(samples.map(s => [s.text, s.styleLevel, s.bold, s.fontSize, !!s.excluded])).toEqual([
      ['第一章 背景', 0, true, 16, false],
      ['继承二级', 1, true, 16, false],
      ['Third', 2, true, 16, false],
      ['Direct', 2, true, 16, false],
      ['Body text', null, true, 16, false],
      ['表格', null, true, 16, true],
    ]);
    expect(extractWordHeadings(samples).map(h => [h.level, h.text])).toEqual([
      [1, '第一章 背景'], [2, '继承二级'], [3, 'Third'], [3, 'Direct'],
    ]);
  });
});
