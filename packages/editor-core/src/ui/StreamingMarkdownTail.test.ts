/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { IncrementalMarkdown } from './IncrementalMarkdown';
import { createStreamingMarkdownRenderer } from './aiChatMarkdown';
import { STREAMING_ROW_LIMIT } from './StreamingMarkdownTail';
import { longStructure, STREAMING_FIXTURE_KINDS } from './StreamingMarkdownTail.fixtures';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
function feed(parser: IncrementalMarkdown, source: string, seed: number): void {
  let offset = 0, value = seed;
  while (offset < source.length) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    const length = seed === 0 ? 1 : 1 + value % 127;
    parser.append(source.slice(offset, offset + length)); offset += length;
  }
}
describe('streaming inside long unfinished Markdown structures', () => {
  for (const kind of STREAMING_FIXTURE_KINDS) {
    it(`${kind}: exact final HTML for 20k/40k/80k character and random fragments`, () => {
      for (const size of [20000, 40000, 80000]) {
        const source = longStructure(kind, size), expected = md.render(source);
        for (const seed of [0, 1, 73]) {
          const parser = new IncrementalMarkdown(md); feed(parser, source, seed);
          expect(parser.html(source, true), `${kind}, ${size}, seed ${seed}`).toBe(expected);
          expect(parser.metrics.parsedCharacters).toBeLessThan(source.length * 160 + STREAMING_ROW_LIMIT ** 2);
        }
      }
    }, 20000);
    it(`${kind}: 64-character appends have linear cumulative parsing work`, () => {
      const counts: number[] = [];
      for (const size of [20000, 40000, 80000]) {
        const source = longStructure(kind, size), parser = new IncrementalMarkdown(md);
        for (let offset = 0; offset < source.length; offset += 64) parser.append(source.slice(offset, offset + 64));
        parser.append('', true); counts.push(parser.metrics.parsedCharacters);
      }
      expect(counts[1]).toBeLessThan(counts[0] * 2.6);
      expect(counts[2]).toBeLessThan(counts[1] * 2.6);
    });
  }
  for (const [kind, selector] of [['fence', 'pre'], ['list', 'ul'], ['quote', 'blockquote'], ['table', 'table']] as const) {
    it(`${kind}: live DOM appends stay bounded and final DOM equals the full renderer`, () => {
      const source = longStructure(kind, 20000), root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
      for (let offset = 0; offset < source.length; offset += 64) renderer.render(root, source.slice(0, offset + 64), () => {}, false, true);
      renderer.render(root, source, () => {}, true, true);
      const expected = document.createElement('div'); expected.innerHTML = md.render(source);
      expect(root.querySelector(selector)!.outerHTML).toBe(expected.querySelector(selector)!.outerHTML);
      expect(renderer.metrics.domCharacters).toBeLessThan(source.length * 80);
    });
  }
  it('transitions from tight to loose list once and retains item DOM until that transition', () => {
    const root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
    const initial = '- first **bold** item\n'.repeat(100);
    renderer.render(root, initial, () => {}, false, true);
    const first = root.querySelector('li');
    renderer.render(root, initial + '- more\n', () => {}, false, true);
    expect(root.querySelector('li')).toBe(first);
    const loose = initial + '- more\n\n- loose\n'; renderer.render(root, loose, () => {}, false, true);
    expect(root.querySelector('li p')).not.toBeNull();
    const afterLoose = root.querySelector('li');
    renderer.render(root, loose + '- final\n', () => {}, false, true);
    expect(root.querySelector('li')).toBe(afterLoose);
    renderer.render(root, loose + '- final\n', () => {}, true, true);
    expect(root.textContent).toContain('final');
  });
  it('appends bounded fence text nodes without replacing earlier code DOM', () => {
    const root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
    const source = '```ts\n' + 'x<&中😀'.repeat(5000);
    renderer.render(root, source.slice(0, 4000), () => {}, false, true);
    const code = root.querySelector('code'), first = code!.firstChild;
    const observer = new MutationObserver(() => {}); observer.observe(root, { childList: true });
    for (let offset = 4000; offset < source.length; offset += 64) renderer.render(root, source.slice(0, offset + 64), () => {}, false, true);
    expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
    expect(root.querySelector('code')).toBe(code); expect(code!.firstChild).toBe(first);
    expect(code!.textContent).toBe(source.slice(source.indexOf('\n') + 1));
    expect(renderer.metrics.domCharacters).toBeLessThan(source.length * 40);
    renderer.render(root, source, () => {}, true, true);
    expect(root.querySelector('code')!.textContent).toBe(source.slice(source.indexOf('\n') + 1));
  });
  it('preserves an unclosed fence final newline exactly as supplied, including CRLF fragments', () => {
    for (const ending of ['', '\n', '\r\n']) {
      const source = '```ts\r\n' + 'literal code & text\r\n'.repeat(100) + 'last line' + ending;
      const root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
      for (let offset = 0; offset < source.length; offset++) renderer.render(root, source.slice(0, offset + 1), () => {}, false, true);
      renderer.render(root, source, () => {}, true, true);
      const expected = document.createElement('div'); expected.innerHTML = md.render(source);
      expect(root.querySelector('code')!.textContent).toBe(expected.querySelector('code')!.textContent);
      expect(root.querySelector('code')!.textContent!.endsWith('\n')).toBe(ending !== '');
    }
  });
  it('keeps both parsing and DOM work bounded for an 80k ambiguous paragraph', () => {
    const source = longStructure('paragraph', 80000), root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
    for (let offset = 0; offset < source.length; offset += 64) renderer.render(root, source.slice(0, offset + 64), () => {}, false, true);
    expect(root.textContent).toContain('words');
    renderer.render(root, source, () => {}, true, true);
    expect(renderer.metrics.domCharacters).toBeLessThan(source.length * 80);
    expect(renderer.metrics.parsedCharacters).toBeLessThan(source.length * 8);
    const expected = document.createElement('div'); expected.innerHTML = md.render(source);
    expect(root.textContent).toBe(expected.textContent);
  });
  it('reconciles nesting, fence closure, marker ambiguity, rich quote lines, tables and late reference definitions', () => {
    const samples = [
      longStructure('fence', 20000) + '\n```\n\nAfter **closure**\n',
      '```\n' + 'code\n'.repeat(1000) + '`'.repeat(12000) + 'x\n```\n',
      longStructure('list', 20000) + '\n\n- loose\n  - nested\n    > quote\n\nAfter\n',
      longStructure('quote', 20000) + '\n> *cross\n> line*\n>\n> - nested\n',
      longStructure('table', 20000) + '\n| escaped \\| and `a|b` | value |\n\nTail\n',
      '[forward][later]\n\n' + longStructure('list', 20000) + '\n\n[later]: /resolved\n',
      '  ```txt\r\n' + '  indented & text\r\n'.repeat(2000) + '  ```\r\n',
      longStructure('paragraph', 40000) + ' *not closed [later]\n\n[later]: /link\n',
    ];
    for (const sample of samples) for (const seed of [0, 17]) {
      const parser = new IncrementalMarkdown(md); feed(parser, sample, seed);
      expect(parser.html(sample, true)).toBe(md.render(sample));
    }
  }, 20000);
});
