import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as ProsemirrorNode } from 'prosemirror-model';

import { schema } from '../../../editor/EditorSchema';
import { insertRuleFromMarkerParagraph } from './HorizontalRuleExtension';

function stateWithCursorAtEnd(doc: ProsemirrorNode, paragraphIndex = doc.childCount - 1): EditorState {
  let pos = 0;
  for (let index = 0; index < paragraphIndex; index++) pos += doc.child(index).nodeSize;
  const end = pos + doc.child(paragraphIndex).nodeSize - 1;
  return EditorState.create({ doc, selection: TextSelection.create(doc, end) });
}

function run(state: EditorState): EditorState | null {
  let next: EditorState | null = null;
  const handled = insertRuleFromMarkerParagraph(schema)(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);

describe('insertRuleFromMarkerParagraph', () => {
  it.each(['---', '***', '___', '-----'])('turns a paragraph holding only %s into a rule followed by an empty paragraph', (marker) => {
    const next = run(stateWithCursorAtEnd(schema.nodes.doc.create(null, [paragraph('上文'), paragraph(marker)])));
    expect(next).not.toBeNull();
    expect(next!.doc.childCount).toBe(3);
    expect(next!.doc.child(1).type.name).toBe('horizontal_rule');
    expect(next!.doc.child(2).type.name).toBe('paragraph');
    expect(next!.selection.$from.parent).toBe(next!.doc.child(2));
  });

  it('leaves other paragraphs to the default Enter handling', () => {
    for (const text of ['--', '-- -', '--- 文字', '-*-', '']) {
      expect(run(stateWithCursorAtEnd(schema.nodes.doc.create(null, [paragraph(text)])))).toBeNull();
    }
  });

  it('only fires when the cursor is at the end of the paragraph', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('---')]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(run(state)).toBeNull();
  });
});
