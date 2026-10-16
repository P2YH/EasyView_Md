/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../../editor/EditorSchema';
import { TableOfContents } from './TableOfContents';

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
});

function setup(miniMap?: { onPin: () => void; onUnpin: () => void }, dockGrip = false) {
  document.body.innerHTML = '<div id="editor-body"><div id="editor-scroll-area"><div id="editor"></div></div></div>';
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 1 }, schema.text('Root')),
    schema.node('paragraph', null, schema.text('Body')),
    schema.node('heading', { level: 2 }, schema.text('Child')),
    schema.node('heading', { level: 3 }, schema.text('Leaf')),
  ]);
  const view = new EditorView(document.getElementById('editor')!, { state: EditorState.create({ schema, doc }) });
  const toc = new TableOfContents(view, { position: 'right', miniMap, dockGrip });
  return { view, toc };
}

it('moves the sidebar and mini map to the other side of the document', () => {
  const { view, toc } = setup({ onPin: vi.fn(), onUnpin: vi.fn() }, true);
  try {
    toc.update(view);
    const scrollArea = document.getElementById('editor-scroll-area')!;
    const sidebar = document.querySelector<HTMLElement>('.toc-sidebar')!;
    const miniMap = document.querySelector<HTMLElement>('.outline-minimap')!;
    const sidebarFollowsDocument = () => Boolean(scrollArea.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sidebar.querySelector('[data-dock-grip="outline"]')).not.toBeNull();
    expect(sidebarFollowsDocument()).toBe(true);

    toc.setPosition('left');
    expect(sidebarFollowsDocument()).toBe(false);
    expect(sidebar.classList.contains('toc-sidebar-left')).toBe(true);
    expect(sidebar.classList.contains('toc-sidebar-right')).toBe(false);
    expect(miniMap.classList.contains('outline-minimap-left')).toBe(true);

    toc.setPosition('right');
    expect(sidebarFollowsDocument()).toBe(true);
    expect(miniMap.classList.contains('outline-minimap-left')).toBe(false);
  } finally {
    toc.destroy();
    view.destroy();
  }
});

it('renders no mini map unless the host opts in', () => {
  const { view, toc } = setup();
  try {
    toc.update(view);
    expect(document.querySelector('.outline-minimap')).toBeNull();
    expect(document.querySelector('.toc-sidebar-unpin')).toBeNull();
  } finally {
    toc.destroy();
    view.destroy();
  }
});

it('shows a heading rail while the sidebar is closed and pins or unpins through the host', () => {
  const onPin = vi.fn();
  const onUnpin = vi.fn();
  const { view, toc } = setup({ onPin, onUnpin });
  try {
    toc.update(view);
    const miniMap = document.querySelector<HTMLElement>('.outline-minimap')!;
    expect(miniMap.hidden).toBe(false);
    expect([...miniMap.querySelectorAll<HTMLElement>('.outline-minimap-dash')].map((dash) => dash.dataset.depth)).toEqual(['0', '1', '2']);
    expect([...miniMap.querySelectorAll('.outline-minimap-item')].map((item) => item.textContent)).toEqual(['Root', 'Child', 'Leaf']);

    miniMap.querySelector<HTMLButtonElement>('.outline-minimap-pin')!.click();
    expect(onPin).toHaveBeenCalledOnce();

    toc.open();
    expect(miniMap.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('.toc-sidebar-unpin')!.click();
    expect(onUnpin).toHaveBeenCalledOnce();

    toc.close();
    expect(miniMap.hidden).toBe(false);
  } finally {
    toc.destroy();
    view.destroy();
  }
  expect(document.querySelector('.outline-minimap')).toBeNull();
});

it('tracks heading edits and hides when the document has no headings', () => {
  const { view, toc } = setup({ onPin: vi.fn(), onUnpin: vi.fn() });
  try {
    toc.update(view);
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, schema.node('paragraph', null, schema.text('Plain')));
    view.updateState(view.state.apply(tr));
    toc.update(view, { docChanged: true });
    expect(document.querySelector<HTMLElement>('.outline-minimap')!.hidden).toBe(true);
  } finally {
    toc.destroy();
    view.destroy();
  }
});

it('navigates through the source-mode handler when one is installed', () => {
  const { view, toc } = setup({ onPin: vi.fn(), onUnpin: vi.fn() });
  const reveal = vi.fn();
  toc.sourceClickHandler = reveal;
  try {
    toc.update(view);
    const child = [...document.querySelectorAll<HTMLButtonElement>('.outline-minimap-item')].find((item) => item.textContent === 'Child')!;
    child.click();
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ level: 2, text: 'Child' });
    expect(child.classList.contains('active')).toBe(true);
  } finally {
    toc.destroy();
    view.destroy();
  }
});
