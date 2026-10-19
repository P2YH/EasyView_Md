/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { installCompactToolbarSearch } from './toolbarSearch';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Mirrors the form @file-viewer/core renders (and re-renders) into its toolbar. */
function renderNativeSearch(toolbar: HTMLElement, query = ''): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'file-viewer-web-toolbar-group file-viewer-web-search';
  form.innerHTML = `<input type="search" value="${query}"><button type="submit" title="Search">Search</button>`
    + '<button type="button" title="Previous">&lt;</button><button type="button" title="Next">&gt;</button>'
    + '<button type="button" title="Clear">x</button><span class="file-viewer-web-search-count">0/0</span>';
  toolbar.replaceChildren(form);
  return form;
}

function setup() {
  const toolbar = document.createElement('div');
  document.body.append(toolbar);
  renderNativeSearch(toolbar);
  const dispose = installCompactToolbarSearch(toolbar);
  return { toolbar, dispose, form: () => toolbar.querySelector<HTMLFormElement>('form')! };
}

it('shows only a search icon until clicked, then opens and focuses the input', () => {
  const { form } = setup();
  const toggle = form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(form().classList.contains('is-search-open')).toBe(false);
  expect(toggle.textContent).toBe('');
  expect(toggle.querySelector('svg')).not.toBeNull();
  expect(form().firstElementChild).toBe(toggle);

  const submit = vi.fn((event: Event) => event.preventDefault());
  form().addEventListener('submit', submit);
  toggle.click();
  expect(submit).not.toHaveBeenCalled();
  expect(form().classList.contains('is-search-open')).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(form().querySelector('input'));
});

it('replaces the text step buttons with icons and keeps state across native re-renders', async () => {
  const { toolbar, form } = setup();
  form().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  for (const step of Array.from(form().querySelectorAll('button:not([type="submit"])'))) {
    expect(step.textContent).toBe('');
    expect(step.querySelector('svg')).not.toBeNull();
  }

  renderNativeSearch(toolbar, 'abc');
  await Promise.resolve();
  expect(form().classList.contains('is-search-open')).toBe(true);
  expect(form().querySelector('button:not([type="submit"])')?.querySelector('svg')).not.toBeNull();
});

it('collapses on Escape, or when focus leaves an empty search box', () => {
  vi.useFakeTimers();
  const { form } = setup();
  form().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  form().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(form().classList.contains('is-search-open')).toBe(false);

  form().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  vi.runAllTimers();
  expect(form().classList.contains('is-search-open')).toBe(false);

  form().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  form().querySelector('input')!.value = 'keep';
  outside.focus();
  vi.runAllTimers();
  expect(form().classList.contains('is-search-open')).toBe(true);
});
