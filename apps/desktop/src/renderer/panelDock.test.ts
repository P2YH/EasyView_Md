/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { defaultDesktopPanelLayout, moveDesktopPanel, normalizeDesktopPanelLayout } from '../contracts';
import { applyWorkbenchPanelLayout } from './panelDock';

describe('desktop panel layout', () => {
  it('defaults to explorer left, AI chat right and outline right', () => {
    expect(normalizeDesktopPanelLayout(undefined)).toEqual({ left: ['explorer'], right: ['aiChat'], outline: 'right' });
  });

  it('drops unknown or duplicate panels and restores missing ones on their default side', () => {
    expect(normalizeDesktopPanelLayout({ left: ['aiChat', 'bogus', 'aiChat'], right: [], outline: 'left' }))
      .toEqual({ left: ['explorer', 'aiChat'], right: [], outline: 'left' });
    expect(normalizeDesktopPanelLayout({ left: [], right: ['explorer'] }))
      .toEqual({ left: [], right: ['explorer', 'aiChat'], outline: 'right' });
  });

  it('docks a panel at the window edge of the chosen side', () => {
    const layout = defaultDesktopPanelLayout();
    expect(moveDesktopPanel(layout, 'aiChat', { kind: 'side', side: 'left' }))
      .toEqual({ left: ['aiChat', 'explorer'], right: [], outline: 'right' });
    expect(moveDesktopPanel(layout, 'explorer', { kind: 'side', side: 'right' }))
      .toEqual({ left: [], right: ['aiChat', 'explorer'], outline: 'right' });
  });

  it('swaps two panels and moves the outline only between document sides', () => {
    const layout = defaultDesktopPanelLayout();
    expect(moveDesktopPanel(layout, 'explorer', { kind: 'swap', panel: 'aiChat' }))
      .toEqual({ left: ['aiChat'], right: ['explorer'], outline: 'right' });
    expect(moveDesktopPanel(layout, 'outline', { kind: 'side', side: 'left' }))
      .toEqual({ left: ['explorer'], right: ['aiChat'], outline: 'left' });
    expect(moveDesktopPanel(layout, 'outline', { kind: 'swap', panel: 'aiChat' })).toBe(layout);
  });

  it('reorders the workbench around the center pane and marks each panel side', () => {
    document.body.innerHTML = '<div id="wb"><aside id="explorer"></aside><main id="center"></main><aside id="chat"></aside></div>';
    const elements = {
      centerPane: document.getElementById('center')!,
      panels: { explorer: document.getElementById('explorer')!, aiChat: document.getElementById('chat')! },
    };
    applyWorkbenchPanelLayout(elements, { left: ['aiChat'], right: ['explorer'], outline: 'right' });
    expect([...document.getElementById('wb')!.children].map((element) => element.id)).toEqual(['chat', 'center', 'explorer']);
    expect(elements.panels.aiChat.dataset.dockSide).toBe('left');
    expect(elements.panels.explorer.dataset.dockSide).toBe('right');

    applyWorkbenchPanelLayout(elements, { left: [], right: ['explorer', 'aiChat'], outline: 'right' });
    expect([...document.getElementById('wb')!.children].map((element) => element.id)).toEqual(['center', 'explorer', 'chat']);
  });
});
