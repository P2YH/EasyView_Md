// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { TextEditorLifecycle } from './textEditorLifecycle';

const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.inert = false; });
const signal = () => new AbortController().signal;
function fixture(flush = async () => {}) {
  const root = document.createElement('section'); document.body.append(root);
  let revision = 3, content = 'confirmed';
  const editor = new TextEditorLifecycle({ documentId: 'note', format: 'markdown', sourceDiskHash: 'baseline', savedEditorRevision: 2, root,
    revision: () => revision, content: () => content, flush,
    restore: async next => { content = next; revision++; },
  });
  disposers.push(() => { editor.dispose(); root.remove(); });
  return { editor, root, edit(next: string) { content = next; revision++; editor.changed(); } };
}

it('captures the text only after IME and a durable ACK; a later save acknowledgement retains newer edits', async () => {
  let acknowledge!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  f.root.dispatchEvent(new CompositionEvent('compositionstart'));
  let captured = false; const pending = f.editor.capture(signal()).then(snapshot => { captured = true; return snapshot; });
  await Promise.resolve(); expect(acknowledge).toBeUndefined();
  f.edit('组合输入'); f.root.dispatchEvent(new CompositionEvent('compositionend'));
  await Promise.resolve(); expect(captured).toBe(false);
  acknowledge(); const snapshot = await pending;
  expect(new TextDecoder().decode(snapshot.bytes)).toBe('组合输入'); expect(snapshot.editorRevision).toBe(4);
  f.edit('newer'); f.editor.acknowledgeSaved(4, 'saved'); expect(f.editor.snapshot().dirty).toBe(true);
});

it('rejects a revision changed while acquiring the commit lease and restores page input after failure, abort and disposal', async () => {
  const f = fixture();
  f.edit('later'); await expect(f.editor.acquireCommitLease(3, signal())).rejects.toThrow('editor_revision_conflict');
  expect(document.body.inert).toBe(false);
  const abort = new AbortController(), lease = await f.editor.acquireCommitLease(4, abort.signal);
  expect(document.body.inert).toBe(true); expect(() => f.editor.assertWritable()).toThrow('editor_busy');
  await expect(f.editor.acquireCommitLease(4, signal())).rejects.toThrow('editor_busy');
  abort.abort(); expect(document.body.inert).toBe(false); lease.release();
  const second = fixture();
  const firstLease = await f.editor.acquireCommitLease(4, signal()), secondLease = await second.editor.acquireCommitLease(3, signal());
  firstLease.release(); expect(document.body.inert).toBe(true);
  second.editor.dispose(); expect(document.body.inert).toBe(false); secondLease.release();
});

it('cancels a composition wait on disposal and rejects recovery from an older document revision', async () => {
  const f = fixture(), snapshot = await f.editor.capture(signal());
  f.edit('manual input'); await expect(f.editor.restore(snapshot, signal())).rejects.toThrow('draft_restore_conflict');
  expect(new TextDecoder().decode((await f.editor.capture(signal())).bytes)).toBe('manual input');
  f.root.dispatchEvent(new CompositionEvent('compositionstart'));
  const pending = f.editor.capture(signal()); f.editor.dispose();
  await expect(pending).rejects.toThrow('editor_disposed');
});
