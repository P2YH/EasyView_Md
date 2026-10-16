/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import type { EditorRuntimeContext } from '../../../runtime/editorRuntimeContext';
import { TableGripToolbar } from './TableGripToolbar';

afterEach(() => {
  document.body.replaceChildren();
});

it.each(['row', 'column'] as const)('names every %s toolbar control on hover', (type) => {
  const toolbar = new TableGripToolbar({ getEditorView: () => null } as unknown as EditorRuntimeContext);
  const grip = document.createElement('div');
  document.body.appendChild(grip);
  try {
    if (type === 'row') toolbar.showForRow(grip, 0);
    else toolbar.showForColumn(grip, 0);
    const controls = [...document.querySelectorAll<HTMLElement>('.table-grip-toolbar .grip-toolbar-btn, .table-grip-toolbar .grip-toolbar-size')];
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      expect(control.title).not.toBe('');
      expect(control.title).toBe(control.getAttribute('aria-label'));
    }
  } finally {
    toolbar.destroy();
  }
});
