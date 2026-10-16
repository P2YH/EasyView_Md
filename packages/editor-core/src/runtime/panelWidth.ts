/**
 * Width limits for resizable side panels. Panels have no fixed maximum: they may grow until the
 * main editor area would drop below {@link EDITOR_MIN_WIDTH}, which keeps the window usable.
 */
export const EDITOR_MIN_WIDTH = 320;
/** Upper bound for persisted widths, only to reject corrupt values (not a UI limit). */
export const PANEL_WIDTH_SANITY_MAX = 8000;

/**
 * Largest width `panel` may take right now, measured at drag start. The editor area is the
 * desktop center pane, or the panel's parent when the panel lives inside the editor (outline).
 */
export function maxPanelWidth(panel: HTMLElement | null | undefined, min: number, doc: Document = document): number {
  const view = doc.defaultView;
  const current = panel?.getBoundingClientRect().width ?? 0;
  const center = doc.getElementById('desktop-center-pane');
  let editorWidth: number | undefined;
  if (center && panel && !center.contains(panel)) editorWidth = center.getBoundingClientRect().width;
  else if (panel?.parentElement) editorWidth = panel.parentElement.getBoundingClientRect().width - current;
  if (editorWidth === undefined || !Number.isFinite(editorWidth) || editorWidth <= 0 && current <= 0) return Math.max(min, (view?.innerWidth ?? 1280) - EDITOR_MIN_WIDTH);
  return Math.max(min, Math.round(current + editorWidth - EDITOR_MIN_WIDTH));
}

export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, width)));
}

export function sanitizePersistedPanelWidth(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(PANEL_WIDTH_SANITY_MAX, value))) : fallback;
}
