const TOOLBARS = ".file-header-toolbar, .file-viewer-web-toolbar, .x-spreadsheet-toolbar, [data-testid='formatting-bar'], .preview-archive-toolbar, .preview-basic-toolbar";
const POPUPS = "select, [role='listbox'], [role='menu'], .x-spreadsheet-dropdown-content, .file-viewer-web-print-menu-panel, .file-header-dropdown";

/** Overflowing document toolbars show only a hairline scrollbar, so a vertical wheel scrolls them sideways. */
export function installToolbarWheelScroll(root: Document | HTMLElement = document): () => void {
  const onWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    if (wheel.shiftKey || wheel.ctrlKey || Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return;
    const target = wheel.target instanceof Element ? wheel.target : null;
    const toolbar = target?.closest<HTMLElement>(TOOLBARS);
    if (!toolbar || target!.closest(POPUPS) || toolbar.scrollWidth <= toolbar.clientWidth) return;
    toolbar.scrollLeft += wheel.deltaY;
    wheel.preventDefault();
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  return () => root.removeEventListener('wheel', onWheel);
}
