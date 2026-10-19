/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { installCompactToolbarIcons } from './toolbarIcons';

afterEach(() => {
  document.body.innerHTML = '';
});

function button(label: string, title: string, className = ''): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.title = title;
  return el;
}

/** Mirrors the zoom group, plain action buttons and print menu @file-viewer/core renders. */
function renderNativeToolbar(toolbar: HTMLElement): void {
  const zoom = document.createElement('div');
  zoom.className = 'file-viewer-web-toolbar-group';
  zoom.append(
    button('-', 'Zoom out', 'file-viewer-web-icon-button'),
    button('60%', 'Reset zoom', 'file-viewer-web-zoom-meter'),
    button('1:1', 'Reset zoom', 'file-viewer-web-icon-button'),
    button('+', 'Zoom in', 'file-viewer-web-icon-button'),
  );
  const print = document.createElement('div');
  print.className = 'file-viewer-web-print-menu';
  const trigger = button('Print', 'Print everything');
  trigger.setAttribute('aria-haspopup', 'menu');
  const panel = document.createElement('div');
  panel.append(button('Direct print', 'Print everything'));
  print.append(trigger, panel);
  const theme = button('', 'Dark', 'file-viewer-web-icon-button file-viewer-web-theme-button');
  toolbar.replaceChildren(zoom, button('Download', 'Download the original file'), print, button('HTML', 'Export HTML'), theme);
}

const labels = (toolbar: HTMLElement): string[] => Array.from(toolbar.querySelectorAll('button')).map(el => el.textContent ?? '');

it('replaces text action buttons with icons and keeps their hover titles', () => {
  const toolbar = document.createElement('div');
  document.body.append(toolbar);
  renderNativeToolbar(toolbar);
  const dispose = installCompactToolbarIcons(toolbar);

  const iconTitles = Array.from(toolbar.querySelectorAll('.preview-toolbar-icon-button')).map(el => (el as HTMLElement).title);
  expect(iconTitles).toEqual(['Zoom out', 'Reset zoom', 'Zoom in', 'Download the original file', 'Print everything', 'Export HTML']);
  expect(labels(toolbar)).toEqual(['', '60%', '', '', '', '', 'Direct print', '', '']);
  dispose();
});

it('re-applies icons after the native toolbar rebuilds', async () => {
  const toolbar = document.createElement('div');
  document.body.append(toolbar);
  renderNativeToolbar(toolbar);
  const dispose = installCompactToolbarIcons(toolbar);

  renderNativeToolbar(toolbar);
  await Promise.resolve();
  expect(toolbar.querySelectorAll('.preview-toolbar-icon').length).toBe(6);
  dispose();
});
