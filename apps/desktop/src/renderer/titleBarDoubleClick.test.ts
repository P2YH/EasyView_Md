/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { installTitleBarDoubleClick } from './titleBarDoubleClick';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup() {
  document.body.innerHTML = '<div id="root"><div class="desktop-tab-bar"><div class="desktop-tab" role="tab">a.md</div></div>'
    + '<button id="toggle">x</button><main id="content"></main></div>';
  const onDoubleClick = vi.fn();
  const dispose = installTitleBarDoubleClick({ root: document.getElementById('root')!, chromeHeight: () => 32, onDoubleClick });
  const dblclick = (selector: string, clientY: number): void => {
    document.querySelector(selector)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientY }));
  };
  return { onDoubleClick, dispose, dblclick };
}

it('fires for double-clicks on empty space in the top row only', () => {
  const { onDoubleClick, dispose, dblclick } = setup();
  dblclick('.desktop-tab-bar', 10);
  expect(onDoubleClick).toHaveBeenCalledTimes(1);
  dblclick('#content', 120);
  expect(onDoubleClick).toHaveBeenCalledTimes(1);
  dispose();
  dblclick('.desktop-tab-bar', 10);
  expect(onDoubleClick).toHaveBeenCalledTimes(1);
});

it('ignores tabs and buttons in the top row', () => {
  const { onDoubleClick, dispose, dblclick } = setup();
  dblclick('.desktop-tab', 10);
  dblclick('#toggle', 10);
  expect(onDoubleClick).not.toHaveBeenCalled();
  dispose();
});
