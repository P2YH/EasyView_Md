/** One visibility preference for document toolbars, including the desktop Markdown toolbar. */
const STORAGE_KEY = 'easyview.preview.toolbarPinned';
const CHANGE_EVENT = 'easyview:toolbarVisibilityChanged';

export function readToolbarPinned(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null || raw === '1' || raw === 'true';
}

export function writeToolbarPinned(visible: boolean): void {
  localStorage.setItem(STORAGE_KEY, visible ? '1' : '0');
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToolbarVisibility(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
