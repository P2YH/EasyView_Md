/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { IncrementalMarkdown } from './IncrementalMarkdown';
import { createStreamingMarkdownRenderer } from './aiChatMarkdown';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const samples = [
  '# Heading\n\nParagraph **strong** _em_ ~~strike~~ [inline](https://example.org).\n\nNext\n---\n',
  'Before\n\n```ts\nconst x = `~~~`;\n\n# inside fence\n```\n\nAfter\n',
  '~~~txt\nnot closed\n\n- still code',
  '- one\n\n- two\n  - nested\n\n    paragraph\n\nend\n',
  '> quote\n>\n> - list\n>   continued\n\nlazy\n\nEnd\n',
  '| A | B |\n| :- | -: |\n| 1 | 2 |\n\nEnd\n',
  '[forward][id] ![image][pic] [shortcut]\n\nOther\n\n[id]: https://example.org\n  "title"\n\n[pic]: /image.png\n[shortcut]: /short\n',
  '[a]\n\n[a]: /first\n\n[a]: /ignored\n\n[a]\n',
  '    indented\n\n    continued\n\n# end\n',
  'hello\n\n#x\n\n- not a list yet\n\n中文😀\r\n\r\nTail',
];
function random(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }; }
describe('incremental Markdown', () => {
  for (const [index, sample] of samples.entries()) it(`matches full rendering for every prefix, sample ${index}`, () => {
    for (let seed = 0; seed < 8; seed++) {
      const next = random(seed), parser = new IncrementalMarkdown(md);
      for (let end = 0; end < sample.length;) {
        end = Math.min(sample.length, end + (seed === 0 ? 1 : 1 + next() % 19));
        expect(parser.html(sample.slice(0, end)), `seed ${seed}, offset ${end}`).toBe(md.render(sample.slice(0, end)));
      }
      expect(parser.html(sample, true)).toBe(md.render(sample));
    }
  });
  it('reuses stable DOM nodes and invalidates forward references', () => {
    const root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
    renderer.render(root, 'First\n\nSecond\n\n', () => {});
    const first = root.querySelector('p');
    renderer.render(root, 'First\n\nSecond\n\nThird\n', () => {});
    expect(root.querySelector('p')).toBe(first);
  });
  it('retains unrelated stable DOM when a later definition resolves a forward reference', () => {
    const root = document.createElement('div'), renderer = createStreamingMarkdownRenderer();
    const source = 'First\n\n[link][id]\n\nTail\n';
    renderer.render(root, source, () => {});
    const first = root.querySelector('p');
    renderer.render(root, source + '\n[id]: /later\n', () => {}, true);
    expect(root.querySelector('p')).toBe(first);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/later');
  });
  it('supports replacement after reset and demonstrates bounded-block linear parsing', () => {
    const parser = new IncrementalMarkdown(md);
    const text = 'Paragraph **bold**.\n\n'.repeat(1000);
    for (let end = 32; end < text.length; end += 32) parser.html(text.slice(0, end));
    expect(parser.html(text, true)).toBe(md.render(text));
    expect(parser.metrics.parsedCharacters).toBeLessThan(text.length * 10);
    expect(parser.html('Replacement', true)).toBe(md.render('Replacement'));
  });
});
