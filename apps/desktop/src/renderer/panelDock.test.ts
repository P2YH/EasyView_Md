/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { defaultDesktopPanelLayout, moveDesktopPanel, normalizeDesktopPanelLayout } from '../contracts';
import { applyTitleBarToggles, applyWorkbenchPanelLayout } from './panelDock';

describe('desktop panel layout', () => {
  it('defaults to explorer left, AI chat right and outline right', () => {
    expect(normalizeDesktopPanelLayout(undefined)).toEqual({ left: ['explorer', 'versionGuard'], right: ['aiChat'], outline: 'right' });
  });

  it('drops unknown or duplicate panels and restores missing ones on their default side', () => {
    expect(normalizeDesktopPanelLayout({ left: ['aiChat', 'bogus', 'aiChat'], right: [], outline: 'left' }))
      .toEqual({ left: ['aiChat', 'explorer', 'versionGuard'], right: [], outline: 'left' });
    expect(normalizeDesktopPanelLayout({ left: [], right: ['explorer'] }))
      .toEqual({ left: ['versionGuard'], right: ['explorer', 'aiChat'], outline: 'right' });
  });

  it('docks a panel at the window edge of the chosen side', () => {
    const layout = defaultDesktopPanelLayout();
    expect(moveDesktopPanel(layout, 'aiChat', { kind: 'side', side: 'left' }))
      .toEqual({ left: ['aiChat', 'explorer', 'versionGuard'], right: [], outline: 'right' });
    expect(moveDesktopPanel(layout, 'explorer', { kind: 'side', side: 'right' }))
      .toEqual({ left: ['versionGuard'], right: ['aiChat', 'explorer'], outline: 'right' });
  });

  it('swaps two panels and moves the outline only between document sides', () => {
    const layout = defaultDesktopPanelLayout();
    expect(moveDesktopPanel(layout, 'explorer', { kind: 'swap', panel: 'aiChat' }))
      .toEqual({ left: ['aiChat', 'versionGuard'], right: ['explorer'], outline: 'right' });
    expect(moveDesktopPanel(layout, 'outline', { kind: 'side', side: 'left' }))
      .toEqual({ left: ['explorer', 'versionGuard'], right: ['aiChat'], outline: 'left' });
    expect(moveDesktopPanel(layout, 'outline', { kind: 'swap', panel: 'aiChat' })).toBe(layout);
  });

  it('reorders the workbench around the center pane and marks each panel side', () => {
    document.body.innerHTML = '<div id="wb"><aside id="explorer"></aside><main id="center"></main><aside id="chat"></aside><aside id="guard"></aside></div>';
    const elements = {
      centerPane: document.getElementById('center')!,
      panels: { explorer: document.getElementById('explorer')!, aiChat: document.getElementById('chat')!, versionGuard: document.getElementById('guard')! },
    };
    applyWorkbenchPanelLayout(elements, { left: ['aiChat', 'versionGuard'], right: ['explorer'], outline: 'right' });
    expect([...document.getElementById('wb')!.children].map((element) => element.id)).toEqual(['chat', 'guard', 'center', 'explorer']);
    expect(elements.panels.aiChat.dataset.dockSide).toBe('left');
    expect(elements.panels.explorer.dataset.dockSide).toBe('right');

    applyWorkbenchPanelLayout(elements, { left: [], right: ['explorer', 'aiChat', 'versionGuard'], outline: 'right' });
    expect([...document.getElementById('wb')!.children].map((element) => element.id)).toEqual(['center', 'explorer', 'chat', 'guard']);
  });

  it('moves each title-bar toggle to its panel side, ahead of other buttons', () => {
    document.body.innerHTML = '<header><div id="left"><button id="explorer"></button><button id="guard"></button></div><div id="right"><button id="chat"></button><button id="other"></button></div></header>';
    const elements = {
      left: document.getElementById('left')!,
      right: document.getElementById('right')!,
      toggles: { explorer: document.getElementById('explorer')!, aiChat: document.getElementById('chat')!, versionGuard: document.getElementById('guard')! },
    };
    const ids = (id: string) => [...document.getElementById(id)!.children].map((element) => element.id);

    applyTitleBarToggles(defaultDesktopPanelLayout(), elements);
    expect(ids('left')).toEqual(['explorer', 'guard']);
    expect(ids('right')).toEqual(['chat', 'other']);
    expect(elements.toggles.explorer.dataset.dockSide).toBe('left');

    applyTitleBarToggles({ left: ['aiChat'], right: ['versionGuard', 'explorer'], outline: 'right' }, elements);
    expect(ids('left')).toEqual(['chat']);
    expect(ids('right')).toEqual(['guard', 'explorer', 'other']);
    expect(elements.toggles.explorer.dataset.dockSide).toBe('right');
    expect(elements.toggles.aiChat.dataset.dockSide).toBe('left');
  });
});
