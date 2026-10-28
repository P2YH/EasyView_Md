// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { ByteEditorLifecycle } from './editorLifecycle';

function fixture(serialize: () => Promise<Uint8Array> = async () => new Uint8Array([1])) {
  const root = document.createElement('div');
  let flushes = 0, restores = 0;
  const editor = new ByteEditorLifecycle({ documentId: 'document-1', format: 'docx', sourceDiskHash: 'baseline',
    root: () => root, flushInput() { flushes++; }, serialize,
    async restore() { restores++; },
  });
  return { editor, root, counts: () => ({ flushes, restores }) };
}
const signal = () => new AbortController().signal;

describe('byte editor revision and input ownership', () => {
  it('rejects a snapshot when input changes during asynchronous serialization and retains newer dirty input after an old save', async () => {
    let complete!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>(resolve => { complete = resolve; });
    const { editor } = fixture(() => pending);
    editor.changed();
    const capturing = editor.capture(signal());
    await Promise.resolve(); editor.changed(); complete(new Uint8Array([1]));
    await expect(capturing).rejects.toThrow('editor_revision_changed');
    editor.acknowledgeSaved(1, 'saved');
    expect(editor.snapshot()).toMatchObject({ dirty: true, editorRevision: 2 });
    editor.acknowledgeSaved(2, 'saved');
    expect(editor.snapshot().dirty).toBe(false);
    editor.dispose();
  });

  it('waits for IME completion and cancels that wait on external disposal', async () => {
    const { editor, counts } = fixture();
    editor.composition(true);
    const captured = editor.capture(signal());
    expect(counts().flushes).toBe(0);
    editor.composition(false);
    await captured; expect(counts().flushes).toBe(1);
    editor.composition(true);
    const detached = editor.capture(signal());
    editor.dispose();
    await expect(detached).rejects.toThrow('editor_disposed');
  });

  it('owns an exclusive input lease, releases on abort, and rejects foreign/base-conflicting recovery bytes', async () => {
    const { editor, root, counts } = fixture();
    const controller = new AbortController();
    const lease = await editor.acquireCommitLease(0, controller.signal);
    expect(root.inert).toBe(true);
    await expect(editor.acquireCommitLease(0, signal())).rejects.toThrow('editor_busy');
    controller.abort(); expect(root.inert).toBe(false); lease.release();
    const draft = await editor.capture(signal());
    await expect(editor.restore({ ...draft, sourceDiskHash: 'other' }, signal())).rejects.toThrow('draft_restore_conflict');
    expect(counts().restores).toBe(0);
    await editor.restore(draft, signal());
    expect(editor.snapshot().dirty).toBe(true);
    expect(counts().restores).toBe(1);
    editor.dispose();
  });
});
