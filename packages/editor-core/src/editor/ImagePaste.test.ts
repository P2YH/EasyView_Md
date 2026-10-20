// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './EditorSchema';
import { clipboardImage, imagePastePlugin, pasteImage, type ImagePasteRequest } from './ImagePaste';

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.innerHTML = ''; });

function mount() {
  const root = document.createElement('section');
  document.body.append(root);
  const view = new EditorView(root, {
    state: EditorState.create({
      doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('abcdef'))),
      plugins: [imagePastePlugin()],
    }),
  });
  views.push(view);
  return { root, view };
}

describe('image paste ownership and insertion', () => {
  it('delivers to the owning root, maps the selected range through edits, and replaces it once', () => {
    const { root, view } = mount();
    const sibling = mount();
    let request: ImagePasteRequest | undefined;
    let leaked = false;
    root.addEventListener('inlinemd:savePastedImage', event => { request = (event as CustomEvent).detail; });
    sibling.root.addEventListener('inlinemd:savePastedImage', () => { leaked = true; });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
    pasteImage(view, Promise.resolve({ dataUrl: 'data:image/png;base64,AA==', name: 'image.png' }));
    expect(request).toBeDefined();
    view.dispatch(view.state.tr.insertText('X', 1));
    request!.insert({ src: 'data:image/png;base64,AA==', originalSrc: './.notes.assets/image.png' });
    expect(view.state.doc.textContent).toBe('Xabef');
    expect(view.state.doc.nodeAt(4)?.attrs.originalSrc).toBe('./.notes.assets/image.png');
    expect(leaked).toBe(false);
    expect(sibling.view.state.doc.textContent).toBe('abcdef');
    request!.insert({ src: 'duplicate', originalSrc: 'duplicate' });
    let count = 0;
    view.state.doc.descendants(node => { if (node.type.name === 'image') count++; });
    expect(count).toBe(1);
  });

  it('cancels failed requests and does not insert into a destroyed editor', () => {
    const { root, view } = mount();
    let request!: ImagePasteRequest;
    root.addEventListener('inlinemd:savePastedImage', event => { request = (event as CustomEvent).detail; });
    pasteImage(view, Promise.resolve({ dataUrl: 'invalid', name: 'image' }));
    request.cancel();
    request.insert({ src: 'unused', originalSrc: 'unused' });
    expect(view.state.doc.textContent).toBe('abcdef');
    view.destroy(); views.pop();
    expect(() => request.insert({ src: 'unused', originalSrc: 'unused' })).not.toThrow();
  });

  it('extracts inline data images but leaves ordinary text untouched', async () => {
    const data = new DataTransfer();
    data.setData('text/plain', 'ordinary markdown');
    expect(clipboardImage(data)).toBeNull();
    data.setData('text/html', '<img src="data:image/png;base64,AA==">');
    await expect(clipboardImage(data)).resolves.toEqual({ dataUrl: 'data:image/png;base64,AA==', name: 'image' });
    data.setData('text/html', '<table><tr><td>Cell</td></tr></table><img src="data:image/png;base64,AA==">');
    expect(clipboardImage(data)).toBeNull();
  });
});
