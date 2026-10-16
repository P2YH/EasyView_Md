/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { clampPanelWidth, EDITOR_MIN_WIDTH, maxPanelWidth, sanitizePersistedPanelWidth } from './panelWidth';

const rect = (el: HTMLElement, width: number) => { el.getBoundingClientRect = () => ({ width } as DOMRect); };
describe('panel width limits', () => {
  it('lets a side panel grow until the editor would drop below its minimum', () => {
    document.body.innerHTML = '<aside id="side"></aside><main id="desktop-center-pane"></main>';
    const side = document.getElementById('side')!; rect(side, 300); rect(document.getElementById('desktop-center-pane')!, 1200);
    expect(maxPanelWidth(side, 220)).toBe(300 + 1200 - EDITOR_MIN_WIDTH);
    rect(document.getElementById('desktop-center-pane')!, 100);
    expect(maxPanelWidth(side, 220)).toBe(220);
  });
  it('clamps and sanitizes widths without a fixed UI maximum', () => {
    expect(clampPanelWidth(1500, 220, 2000)).toBe(1500);
    expect(sanitizePersistedPanelWidth(1400, 220, 280)).toBe(1400);
    expect(sanitizePersistedPanelWidth('x', 220, 280)).toBe(280);
  });
});
