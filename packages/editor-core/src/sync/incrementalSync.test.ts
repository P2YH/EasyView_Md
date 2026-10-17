import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { EditorSyncAdapter } from './editorSyncAdapter';
import { hashContent } from '@easyview/editor-sync';
describe('ChangeSet sync', () => {
  it('matches full text for multi-cursor, paste, delete, undo/redo and invalid incremental offsets', () => {
    const sent: any[] = [];
    const adapter = new EditorSyncAdapter({ postMessage: message => sent.push(message), getSettings: () => ({ fullWidth: false, tocVisible: false, tableWrap: false }), onSnapshot: () => {}, onExternalContent: () => true });
    let state = EditorState.create({ doc: 'first\nsecond\nthird', extensions: [history(), EditorState.allowMultipleSelections.of(true)] });
    adapter.handleMessage({ type: 'documentSnapshot', documentId: 'doc', revision: 0, content: state.doc.toString(), contentHash: hashContent(state.doc.toString()) });
    let revision = 0;
    const apply = (transaction: import('@codemirror/state').Transaction) => {
      const edits: import('@easyview/editor-sync').TextOffsetPatch[] = [];
      transaction.changes.iterChanges((from, to, _a, _b, insert) => edits.push({ from, to, insert: insert.toString() }));
      state = transaction.state;
      const previousSent = sent.length;
      adapter.applyLocalContent(state.doc.toString(), 'local', edits);
      expect(adapter.content).toBe(state.doc.toString());
      const message = sent.slice(previousSent).find(message => message.type === 'applyEdits');
      if (message?.type === 'applyEdits') adapter.handleMessage({ type: 'editsApplied', documentId: 'doc', revision: ++revision, clientEditId: message.clientEditId, resultHash: message.resultHash });
    };
    apply(state.update({ changes: [{ from: 1, insert: '😀' }, { from: 8, to: 10, insert: 'paste\n多行' }], userEvent: 'input.paste' }));
    apply(state.update({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(10)]) }));
    apply(state.update(state.changeByRange(range => ({ changes: { from: range.from, insert: 'X' }, range: EditorSelection.cursor(range.from + 1) }))));
    undo({ state, dispatch: apply }); redo({ state, dispatch: apply });
    expect(sent.some(message => message.type === 'requestResync')).toBe(false);
    adapter.applyLocalContent('fallback', 'local', [{ from: 9999, to: 9999, insert: 'unsafe' }]);
    expect(adapter.content).toBe('fallback'); adapter.dispose();
  });
});
