const SEARCH_ICON = '<svg class="preview-search-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
const stepIcon = (d: string): string => `<svg class="preview-search-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
/** The native form labels its step buttons with plain "<", ">" and "x" glyphs. */
const STEP_ICONS: Record<string, string> = {
  '<': stepIcon('m15 18-6-6 6-6'),
  '>': stepIcon('m9 18 6-6-6-6'),
  x: stepIcon('M18 6 6 18M6 6l12 12'),
};

/** Adapt the native search form without replacing its query/result handlers. */
export function installCompactToolbarSearch(toolbar: HTMLElement): () => void {
  let expanded = false;
  const sync = (): void => {
    const group = toolbar.querySelector<HTMLElement>('.file-viewer-web-search');
    const button = group?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!group || !button) return;
    group.classList.add('preview-search-compact');
    group.classList.toggle('is-search-open', expanded);
    button.classList.add('preview-search-toggle');
    button.setAttribute('aria-expanded', String(expanded));
    if (!button.querySelector('.preview-search-icon')) button.innerHTML = SEARCH_ICON;
    for (const step of Array.from(group.querySelectorAll<HTMLButtonElement>('button:not([type="submit"])'))) {
      const icon = STEP_ICONS[step.textContent?.trim() ?? ''];
      if (icon) step.innerHTML = icon;
    }
    if (group.firstElementChild !== button) group.prepend(button);
  };
  const collapse = (): void => {
    expanded = false;
    sync();
  };
  const onClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.preview-search-toggle');
    if (!button || !toolbar.contains(button) || expanded) return;
    event.preventDefault();
    expanded = true;
    sync();
    const input = button.closest('.file-viewer-web-search')?.querySelector<HTMLInputElement>('input[type="search"]');
    input?.focus();
    input?.select();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !expanded || !(event.target as Element).closest('.file-viewer-web-search')) return;
    event.preventDefault();
    event.stopPropagation();
    collapse();
    toolbar.querySelector<HTMLButtonElement>('.preview-search-toggle')?.focus();
  };
  let focusTimer = 0;
  // The native toolbar re-renders its form on state changes, so judge focus against the current form a tick later.
  const onFocusOut = (event: FocusEvent): void => {
    if (!expanded || !(event.target as Element).closest('.file-viewer-web-search')) return;
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      const group = toolbar.querySelector<HTMLElement>('.file-viewer-web-search');
      if (!expanded || !group || group.contains(toolbar.ownerDocument.activeElement)) return;
      if (group.querySelector<HTMLInputElement>('input[type="search"]')?.value.trim()) return;
      collapse();
    });
  };
  const observer = new MutationObserver(sync);
  observer.observe(toolbar, { childList: true });
  toolbar.addEventListener('click', onClick, true);
  toolbar.addEventListener('keydown', onKeyDown, true);
  toolbar.addEventListener('focusout', onFocusOut);
  sync();
  return () => {
    window.clearTimeout(focusTimer);
    observer.disconnect();
    toolbar.removeEventListener('click', onClick, true);
    toolbar.removeEventListener('keydown', onKeyDown, true);
    toolbar.removeEventListener('focusout', onFocusOut);
  };
}
