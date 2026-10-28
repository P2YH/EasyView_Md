/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { installToolbarWheelScroll } from './toolbarWheelScroll';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(scrollWidth: number) {
  document.body.innerHTML = '<div data-testid="formatting-bar"><button id="bold">B</button><div role="listbox"><div id="option">Arial</div></div></div>';
  const toolbar = document.querySelector<HTMLElement>('[data-testid="formatting-bar"]')!;
  Object.defineProperty(toolbar, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, value: 400 });
  const dispose = installToolbarWheelScroll(document);
  const wheel = (selector: string, init: WheelEventInit): WheelEvent => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    if (init.ctrlKey) Object.defineProperty(event, 'ctrlKey', { value: true });
    document.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  return { toolbar, dispose, wheel };
}

it('turns a vertical wheel over an overflowing toolbar into horizontal scrolling', () => {
  const { toolbar, dispose, wheel } = setup(900);
  const event = wheel('#bold', { deltaY: 120 });
  expect(toolbar.scrollLeft).toBe(120);
  expect(event.defaultPrevented).toBe(true);
  dispose();
  wheel('#bold', { deltaY: 120 });
  expect(toolbar.scrollLeft).toBe(120);
});

it('leaves fitting toolbars, popups, horizontal and modified wheels alone', () => {
  const { toolbar, dispose, wheel } = setup(900);
  expect(wheel('#option', { deltaY: 120 }).defaultPrevented).toBe(false);
  expect(wheel('#bold', { deltaY: 10, deltaX: 40 }).defaultPrevented).toBe(false);
  expect(wheel('#bold', { deltaY: 120, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(toolbar.scrollLeft).toBe(0);
  dispose();

  const fitting = setup(400);
  expect(fitting.wheel('#bold', { deltaY: 120 }).defaultPrevented).toBe(false);
  fitting.dispose();
});
