import { Plugin, PluginKey, type SelectionBookmark } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './EditorSchema';

export interface ClipboardImage { dataUrl: string; name: string }
export interface PastedImage { src: string; originalSrc: string }
export interface ImagePasteRequest {
  image: Promise<ClipboardImage>;
  insert(image: PastedImage): void;
  cancel(): void;
}

/** Read the same image payloads in both editor modes. Tables retain their own paste path. */
export function clipboardImage(data: DataTransfer | null): Promise<ClipboardImage> | null {
  const text = data?.getData('text/plain') ?? '';
  const html = data?.getData('text/html') ?? '';
  if (/<table(?:\s|>)/i.test(html)) return null;
  const dataUrl = html.match(/src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']/i)?.[1]
    ?? text.match(/!\[[^\]]*]\(\s*(data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\s*\)/i)?.[1]
    ?? text.match(/^(data:image\/[a-zA-Z0-9.+-]+;base64,\S+)$/i)?.[1];
  if (dataUrl) return Promise.resolve({ dataUrl, name: 'image' });
  const item = Array.from(data?.items ?? []).find(item => item.kind === 'file' && item.type.startsWith('image/'));
  const file = item?.getAsFile() ?? Array.from(data?.files ?? []).find(file => file.type.startsWith('image/'));
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result), name: file.name || 'image.png' });
    reader.onerror = () => reject(reader.error ?? new Error('Could not read clipboard image'));
    reader.readAsDataURL(file);
  });
}

export function requestImagePaste(target: HTMLElement, request: ImagePasteRequest): void {
  target.dispatchEvent(new CustomEvent<ImagePasteRequest>('inlinemd:savePastedImage', {
    bubbles: true, detail: request,
  }));
}

const pendingImages = new PluginKey<Map<object, SelectionBookmark>>('pendingImagePastes');
/** Map the original selection through edits made while an image is being saved. */
export function imagePastePlugin(): Plugin {
  return new Plugin({
    key: pendingImages,
    state: {
      init: () => new Map<object, SelectionBookmark>(),
      apply(tr, previous) {
        const next = new Map<object, SelectionBookmark>();
        previous.forEach((selection, id) => next.set(id, selection.map(tr.mapping)));
        const action = tr.getMeta(pendingImages);
        if (action?.add) next.set(action.add, tr.selection.getBookmark());
        if (action?.remove) next.delete(action.remove);
        return next;
      },
    },
  });
}

export function pasteImage(view: EditorView, image: Promise<ClipboardImage>): void {
  const id = {};
  view.dispatch(view.state.tr.setMeta(pendingImages, { add: id }));
  const cancel = () => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(pendingImages, { remove: id }));
  };
  requestImagePaste(view.dom, {
    image, cancel,
    insert({ src, originalSrc }) {
      if (view.isDestroyed) return;
      const bookmark = pendingImages.getState(view.state)?.get(id);
      if (!bookmark) return;
      view.dispatch(view.state.tr
        .setSelection(bookmark.resolve(view.state.doc))
        .replaceSelectionWith(schema.nodes.image.create({ src, originalSrc, alt: '' }))
        .setMeta(pendingImages, { remove: id })
        .scrollIntoView());
    },
  });
}
