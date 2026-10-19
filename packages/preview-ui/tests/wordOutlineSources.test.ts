/** @vitest-environment happy-dom */
import JSZip from 'jszip';
import { afterEach, expect, it } from 'vitest';
import {
  matchHeadingsToParagraphs,
  msdocStyleLevel,
  readDocxPackageHeadings,
  readMsdocOutline,
  samplesFromPmDoc,
} from '../src/viewers/wordOutlineSources';

afterEach(() => {
  document.body.innerHTML = '';
});

it('reads .doc headings from msdoc style classes', () => {
  document.body.innerHTML = `<div class="msdoc-root">
    <p class="msdoc-paragraph msdoc-style-标题-1">第一章 总则</p>
    <p class="msdoc-paragraph msdoc-style-normal">正文</p>
    <p class="msdoc-paragraph msdoc-style-heading-2">1.1 范围</p>
  </div>`;
  const outline = readMsdocOutline(document.querySelector('.msdoc-root')!);
  expect(outline.headings.map(h => [h.level, h.text, h.inferred])).toEqual([[1, '第一章 总则', false], [2, '1.1 范围', false]]);
  expect(outline.elements[outline.headings[1].index].textContent).toBe('1.1 范围');
  expect(msdocStyleLevel(document.querySelector('.msdoc-style-normal')!)).toBeNull();
});

it('falls back to bold, large .doc paragraphs when no heading style is used', () => {
  const long = '这是用于确定正文字号的较长段落，内容足够长，不会被当作标题来处理。';
  document.body.innerHTML = `<div class="msdoc-root">
    <p class="msdoc-paragraph msdoc-style-normal"><span style="font-weight:700;font-size:24pt">第一章 项目背景</span></p>
    <p class="msdoc-paragraph msdoc-style-normal"><span style="font-size:12pt">${long}</span></p>
    <p class="msdoc-paragraph msdoc-style-normal"><span style="font-weight:700;font-size:18pt">项目目标</span></p>
    <p class="msdoc-paragraph msdoc-style-normal"><span style="font-size:12pt">${long}</span></p>
    <p class="msdoc-paragraph msdoc-style-normal"><span style="font-weight:700;font-size:12pt">加粗但字号一样</span></p>
    <table><tr><td><p class="msdoc-paragraph"><span style="font-weight:700;font-size:24pt">表格标题</span></p></td></tr></table>
  </div>`;
  const outline = readMsdocOutline(document.querySelector('.msdoc-root')!);
  expect(outline.headings.map(h => [h.level, h.text, h.inferred])).toEqual([[1, '第一章 项目背景', true], [2, '项目目标', true]]);
});

it('reads headings straight from a .docm package', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const zip = new JSZip();
  zip.file('word/styles.xml', `<w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`);
  zip.file('word/document.xml', `<w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>宏文档标题</w:t></w:r></w:p><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>`);
  const headings = await readDocxPackageHeadings(await zip.generateAsync({ type: 'arraybuffer' }));
  expect(headings).toEqual([{ level: 1, text: '宏文档标题', inferred: false, index: 0 }]);
  expect(await readDocxPackageHeadings(await new JSZip().generateAsync({ type: 'arraybuffer' }))).toEqual([]);
});

it('pairs package headings with rendered paragraphs in order', () => {
  document.body.innerHTML = '<p>标题</p><p>正文</p><p>标题</p><p>第二节</p>';
  const paragraphs = Array.from(document.querySelectorAll('p'));
  const outline = matchHeadingsToParagraphs([
    { level: 1, text: '标题', inferred: false, index: 0 },
    { level: 1, text: '标题', inferred: false, index: 5 },
    { level: 2, text: '缺失', inferred: false, index: 7 },
    { level: 2, text: '第二节', inferred: false, index: 9 },
  ], paragraphs);
  expect(outline.elements).toEqual([paragraphs[0], paragraphs[2], paragraphs[3]]);
  expect(outline.headings.map(h => [h.text, h.index])).toEqual([['标题', 0], ['标题', 1], ['第二节', 2]]);
});

it('samples ProseMirror paragraphs with outline levels, marks and positions', () => {
  type Node = Parameters<typeof samplesFromPmDoc>[0];
  const text = (value: string, marks: Array<[string, Record<string, unknown>]>) => ({
    type: { name: 'text' }, attrs: {}, isText: true, text: value, textContent: value,
    marks: marks.map(([name, attrs]) => ({ type: { name }, attrs })),
    forEach: () => undefined, descendants: () => undefined,
  }) as Node;
  const para = (attrs: Record<string, unknown>, children: Node[]) => ({
    type: { name: 'paragraph' }, attrs, textContent: children.map(c => c.textContent).join(''),
    forEach: (fn: (child: Node, offset: number) => void) => children.forEach((c, i) => fn(c, i)),
    descendants: () => undefined,
  }) as Node;
  const blocks: Array<[Node, number, string]> = [
    [para({ outlineLevel: 0, styleId: '1' }, [text('第一章', [['bold', {}], ['fontSize', { size: 44 }]])]), 0, 'doc'],
    [para({ styleId: 'Heading2' }, [text('Styled by id', [])]), 10, 'doc'],
    [para({}, [text('第二章 ', [['bold', {}], ['fontSize', { size: 28 }]]), text('总则', [['bold', {}]])]), 30, 'doc'],
    [para({}, [text('cell', [['bold', {}]])]), 50, 'tableCell'],
  ];
  const doc = {
    type: { name: 'doc' }, attrs: {}, textContent: '',
    forEach: () => undefined,
    descendants: (fn: (node: Node, pos: number, parent: Node | null) => boolean | void) => {
      for (const [node, pos, parent] of blocks) fn(node, pos, { type: { name: parent } } as Node);
    },
  } as Node;
  const { samples, positions } = samplesFromPmDoc(doc);
  expect(positions).toEqual([0, 10, 30, 50]);
  expect(samples.map(s => [s.text, s.styleLevel, s.bold, s.fontSize, !!s.excluded])).toEqual([
    ['第一章', 0, true, 22, false],
    ['Styled by id', 1, false, null, false],
    ['第二章 总则', null, true, 14, false],
    ['cell', null, true, null, true],
  ]);
});
