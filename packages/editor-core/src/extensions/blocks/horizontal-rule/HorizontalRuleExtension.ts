/**
 * HorizontalRuleExtension
 *
 * Handles horizontal rule (thematic break) nodes.
 */

import { InputRule } from 'prosemirror-inputrules';
import type { NodeSpec, Schema } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import {
  Extension,
  type SerializerNodeHandler,
} from '../../../editor/EditorExtension';

const RULE_MARKER_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** Enter at the end of a paragraph that holds only `---` / `***` / `___` turns it into a rule. */
export function insertRuleFromMarkerParagraph(schema: Schema): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const { $from } = selection;
    const paragraph = $from.parent;
    if (paragraph.type !== schema.nodes.paragraph || $from.parentOffset !== paragraph.content.size) return false;
    if (!RULE_MARKER_RE.test(paragraph.textContent)) return false;
    const container = $from.node($from.depth - 1);
    if (container.type !== schema.nodes.doc && container.type.name !== 'blockquote') return false;
    if (dispatch) {
      const start = $from.before();
      const end = $from.after();
      const tr = state.tr.replaceWith(start, end, [schema.nodes.horizontal_rule.create(), schema.nodes.paragraph.create()]);
      tr.setSelection(TextSelection.create(tr.doc, start + 2));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export class HorizontalRuleExtension extends Extension {
  get name() {
    return 'horizontalRule';
  }

  get nodes(): Record<string, NodeSpec> {
    return {
      horizontal_rule: {
        group: 'block',
        atom: true,
        selectable: true,
        parseDOM: [{ tag: 'hr' }],
        toDOM() {
          return ['hr'];
        },
      },
    };
  }

  inputRules(schema: Schema): InputRule[] {
    return [
      new InputRule(/^(?:---|\*\*\*|___)\s$/, (state, _match, start, end) => {
        return state.tr.replaceWith(
          start - 1,
          end,
          schema.nodes.horizontal_rule.create()
        );
      }),
    ];
  }

  keymaps(schema: Schema): Record<string, Command> {
    return { Enter: insertRuleFromMarkerParagraph(schema) };
  }

  get serializerNodes(): Record<string, SerializerNodeHandler> {
    return {
      horizontal_rule(state, node) {
        state.write('---');
        state.closeBlock(node);
      },
    };
  }
}
