import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from '../EditorSchema';
import { createParser, parseMarkdown } from './MarkdownParser';
import { docToMarkdown } from './MarkdownSerializer';
import { IncrementalMarkdownSerializer } from './IncrementalMarkdownSerializer';
import { applyTextPatches } from '@easyview/editor-sync';
const source = '# Heading\n\nA **bold** paragraph.\n\n- one\n- two\n\n- another\n\n> quote\n\n```ts\nlet a=1\n```\n\nEnd';
describe('incremental PM serialization', () => {
  it('matches the canonical serializer through typing, paste, marks, structural edits and undo/redo', () => {
    let state = EditorState.create({ doc: parseMarkdown(source, createParser())!, plugins: [history()] });
    const serializer = new IncrementalMarkdownSerializer(); let content = source;
    const check = () => {
      const result = serializer.serialize(state.doc, content);
      expect(result.content).toBe(docToMarkdown(state.doc));
      expect(applyTextPatches(content, result.edits)).toBe(result.content); content = result.content;
    };
    check();
    for (let i = 0; i < 30; i++) {
      const tr = state.tr.insertText(` ${i}*中😀`, Math.min(15 + i, state.doc.content.size - 1)); serializer.observeTransaction(tr); state = state.apply(tr); check();
    }
    state = state.apply(state.tr.replaceSelectionWith(schema.nodes.paragraph.create(null, schema.text('pasted')))); check();
    state = state.apply(state.tr.addMark(2, 5, schema.marks.strong.create())); check();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))); check();
    undo(state, tr => { state = state.apply(tr); }); check();
    redo(state, tr => { state = state.apply(tr); }); check();
    expect(serializer.metrics.reusedNodes).toBeGreaterThan(30);
  });
  it('falls back for document-wide table metadata and mismatched baselines', () => {
    const serializer = new IncrementalMarkdownSerializer();
    const doc = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |', createParser())!;
    expect(serializer.serialize(doc, 'different').content).toBe(docToMarkdown(doc));
    expect(serializer.metrics.fallbacks).toBe(1);
  });
  it('matches mixed structural documents and empty blocks through random range edits', () => {
    const samples = [
      '\n', '# H\n\n\n\nParagraph  \nnext\n',
      '- first\n- second\n\n1. ordered\n2. item\n\n> a\n>\n> b',
      '---\ntitle: test\n---\n\nText\n\n```js\nconst value = 1;\n```',
      'A [link](https://example.org) and ![image](/image.png)\n\n---\n\nEnd',
      '```html\n<tr>\n<td>value\n</td>\n</tr>\n```',
    ];
    for (const source of samples) {
      let state = EditorState.create({ doc: parseMarkdown(source, createParser())! });
      const serializer = new IncrementalMarkdownSerializer(); let content = source;
      for (let i = 0; i < 20; i++) {
        const result = serializer.serialize(state.doc, content);
        expect(result.content, source).toBe(docToMarkdown(state.doc));
        expect(applyTextPatches(content, result.edits)).toBe(result.content); content = result.content;
        const positions: number[] = []; state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1); });
        const position = positions[(i * 7) % positions.length];
        const tr = state.tr.insertText(i % 2 ? '中' : ' *x* ', position);
        serializer.observeTransaction(tr); state = state.apply(tr);
      }
    }
  });

});
