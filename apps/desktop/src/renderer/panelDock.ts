import {
  desktopPanelSide,
  moveDesktopPanel,
  type DesktopDockPanelId,
  type DesktopPanelDropTarget,
  type DesktopPanelLayout,
  type DesktopWorkbenchPanelId,
} from '../contracts';
import { tDesktop } from './desktopRenderer.i18n';

export const DOCK_GRIP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';

const DRAG_THRESHOLD_PX = 4;
const SIDE_ZONE_MAX_PX = 220;
const DOCK_PANEL_IDS: readonly DesktopDockPanelId[] = ['explorer', 'aiChat', 'outline'];

export interface PanelDockElements {
  centerPane: HTMLElement;
  panels: Record<DesktopWorkbenchPanelId, HTMLElement>;
}

export interface PanelDockOptions extends PanelDockElements {
  getLayout(): DesktopPanelLayout;
  onLayoutChange(layout: DesktopPanelLayout): void;
}

interface DropZone {
  target: DesktopPanelDropTarget;
  rect: DOMRect;
  element: HTMLElement;
}

interface DragSession {
  move(x: number, y: number): void;
  target(): DesktopPanelDropTarget | null;
  dispose(): void;
}

/** Window-level panels sit before the center pane (left, outermost first) or after it (right). */
export function applyWorkbenchPanelLayout({ centerPane, panels }: PanelDockElements, layout: DesktopPanelLayout): void {
  // Moving a node resets its scroll position, so panels already in place stay put.
  let anchor: Element = centerPane;
  for (const element of layout.left.map((id) => panels[id]).reverse()) {
    if (anchor.previousElementSibling !== element) anchor.before(element);
    anchor = element;
  }
  anchor = centerPane;
  for (const element of layout.right.map((id) => panels[id])) {
    if (anchor.nextElementSibling !== element) anchor.after(element);
    anchor = element;
  }
  for (const id of Object.keys(panels) as DesktopWorkbenchPanelId[]) {
    panels[id].dataset.dockSide = desktopPanelSide(layout, id);
  }
}

const PANEL_LABEL_KEYS = {
  explorer: 'dock.panel.explorer',
  aiChat: 'dock.panel.aiChat',
  outline: 'dock.panel.outline',
} as const;

function panelLabel(panel: DesktopDockPanelId): string {
  return tDesktop(PANEL_LABEL_KEYS[panel]);
}

function sameLayout(a: DesktopPanelLayout, b: DesktopPanelLayout): boolean {
  return a.outline === b.outline && a.left.join() === b.left.join() && a.right.join() === b.right.join();
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

/**
 * VS Code-style docking: drag a panel by its `[data-dock-grip]` handle, drop it on a highlighted
 * zone to dock it on a side (window edge, or the document edge for the outline) or to swap it
 * with another window-level panel.
 */
export function installPanelDock(options: PanelDockOptions): () => void {
  let cancelDrag: (() => void) | null = null;

  const sideZoneRect = (area: DOMRect, side: 'left' | 'right'): DOMRect => {
    const width = Math.min(SIDE_ZONE_MAX_PX, area.width / 3);
    return new DOMRect(side === 'left' ? area.left : area.right - width, area.top, width, area.height);
  };

  const collectTargets = (panel: DesktopDockPanelId, grip: HTMLElement): Array<{ target: DesktopPanelDropTarget; rect: DOMRect; label: string }> => {
    const layout = options.getLayout();
    const targets: Array<{ target: DesktopPanelDropTarget; rect: DOMRect; label: string }> = [];
    if (panel === 'outline') {
      const documentArea = (grip.closest<HTMLElement>('#editor-body') ?? options.centerPane).getBoundingClientRect();
      targets.push(
        { target: { kind: 'side', side: 'left' }, rect: sideZoneRect(documentArea, 'left'), label: tDesktop('dock.documentLeft') },
        { target: { kind: 'side', side: 'right' }, rect: sideZoneRect(documentArea, 'right'), label: tDesktop('dock.documentRight') },
      );
    } else {
      const center = options.centerPane.getBoundingClientRect();
      targets.push(
        { target: { kind: 'side', side: 'left' }, rect: sideZoneRect(center, 'left'), label: tDesktop('dock.windowLeft') },
        { target: { kind: 'side', side: 'right' }, rect: sideZoneRect(center, 'right'), label: tDesktop('dock.windowRight') },
      );
      for (const other of Object.keys(options.panels) as DesktopWorkbenchPanelId[]) {
        if (other === panel || !isVisible(options.panels[other])) continue;
        targets.push({
          target: { kind: 'swap', panel: other },
          rect: options.panels[other].getBoundingClientRect(),
          label: tDesktop('dock.swap', { name: panelLabel(other) }),
        });
      }
    }
    return targets.filter(({ target }) => !sameLayout(moveDesktopPanel(layout, panel, target), layout));
  };

  const beginDrag = (panel: DesktopDockPanelId, grip: HTMLElement, x: number, y: number): DragSession => {
    const overlay = document.createElement('div');
    overlay.className = 'dock-overlay';
    const zones: DropZone[] = collectTargets(panel, grip).map(({ target, rect, label }) => {
      const element = document.createElement('div');
      element.className = 'dock-zone';
      element.dataset.kind = target.kind;
      Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      const text = document.createElement('span');
      text.className = 'dock-zone-label';
      text.textContent = label;
      element.appendChild(text);
      overlay.appendChild(element);
      return { target, rect, element };
    });
    const ghost = document.createElement('div');
    ghost.className = 'dock-ghost';
    ghost.textContent = panelLabel(panel);
    overlay.appendChild(ghost);
    document.body.appendChild(overlay);
    document.body.classList.add('dock-dragging');

    let hovered: DropZone | null = null;
    const move = (nextX: number, nextY: number): void => {
      ghost.style.transform = `translate(${nextX + 12}px, ${nextY + 12}px)`;
      const next = zones.find(({ rect }) => nextX >= rect.left && nextX <= rect.right && nextY >= rect.top && nextY <= rect.bottom) ?? null;
      if (next === hovered) return;
      hovered?.element.classList.remove('is-active');
      next?.element.classList.add('is-active');
      hovered = next;
    };
    move(x, y);
    return {
      move,
      target: () => hovered?.target ?? null,
      dispose: () => {
        overlay.remove();
        document.body.classList.remove('dock-dragging');
      },
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || cancelDrag) return;
    const grip = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-dock-grip]') : null;
    const panel = grip?.dataset.dockGrip as DesktopDockPanelId | undefined;
    if (!grip || !panel || !DOCK_PANEL_IDS.includes(panel)) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    let session: DragSession | null = null;

    const onMove = (moveEvent: PointerEvent): void => {
      if (!session && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
      session ??= beginDrag(panel, grip, moveEvent.clientX, moveEvent.clientY);
      session.move(moveEvent.clientX, moveEvent.clientY);
    };
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKeyDown, true);
      cancelDrag = null;
      const target = commit ? session?.target() ?? null : null;
      session?.dispose();
      if (!target) return;
      const layout = options.getLayout();
      const next = moveDesktopPanel(layout, panel, target);
      if (!sameLayout(next, layout)) options.onLayoutChange(next);
    };
    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKeyDown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKeyDown, true);
    cancelDrag = onCancel;
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    cancelDrag?.();
  };
}
