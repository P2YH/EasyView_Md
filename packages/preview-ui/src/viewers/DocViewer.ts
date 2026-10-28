// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../css-modules.d.ts" />
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { DocxEditorRef } from '@eigenpal/docx-editor-react';
import type { PreviewWriteResult } from '@easyview/contracts';
import type { PreviewHost } from '../types';
import { ByteEditorLifecycle } from '../editorLifecycle';
import {
  extension,
  h,
  loadingElement,
  UniversalFilePreview,
  ViewerError,
  type ViewerProps,
} from './shared';
import {
  DocumentChromeActions,
  DocumentExportIcon,
  DocumentPrintIcon,
  DocumentRouteShell,
  easyViewThemeToDocxColorMode,
  readWordCommentsSidebarOpen,
  useDocumentRouteTheme,
  useToolbarPinned,
  writeWordCommentsSidebarOpen,
} from './DocumentRouteChrome';
import { isEditableWordFile } from '../word/editableFormats';
import { tPreview } from '../preview.i18n';
import { installPreviewSidebarResize } from '../previewSidebarResize';
import { PREVIEW_SIDEBAR_ICON } from '../previewSidebarToggle';
import { readWordOutlinePinned, writeWordOutlinePinned } from './wordOutlinePrefs';
import { installWordOutline, wordOutlineLabels } from './wordOutlinePane';
import { createDocxEditorOutlineSource, type DocxOutlineEditor } from './wordOutlineSources';

export interface DocViewerProps extends ViewerProps {
  host?: PreviewHost;
}

/**
 * Word route handler: editable OOXML (.docx/.dotx) when the host can write bytes;
 * .doc and other word formats stay on UniversalFilePreview (same chrome as PDF).
 * Theme uses EasyView per-file preview theme only — DocxEditor has no independent theme UI.
 *
 * Top formatting bar comes from DocxEditor (`showToolbar` + `toolbarExtra`).
 * EasyView save/export/print/theme/collapse are injected into that same bar via toolbarExtra,
 * Collapse keeps the host toolbar mounted and hides it with the shared upward animation.
 */
export function DocViewer({ descriptor, host }: DocViewerProps): React.ReactElement {
  if (isEditableWordFile(descriptor.fileName) && host?.writeBytes && host.canEdit !== false) {
    return h(WordEditor, { descriptor, host });
  }
  return h(UniversalFilePreview, { descriptor, loadingLabel: tPreview('word.loadingViewer') });
}

function WordEditor({ descriptor, host }: { descriptor: ViewerProps['descriptor']; host: PreviewHost }): React.ReactElement {
  const editorRef = React.useRef<DocxEditorRef | null>(null);
  const lifecycleRef = React.useRef<ByteEditorLifecycle | null>(null);
  const registeredRef = React.useRef<{ lifecycle: ByteEditorLifecycle; unregister(): void } | null>(null);
  const restoredViewRef = React.useRef<{ ready(): void; fail(error: unknown): void } | null>(null);
  const [DocxEditor, setDocxEditor] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const [buffer, setBuffer] = React.useState<ArrayBuffer | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(true);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const { themeMode, cycleTheme, viewerVars } = useDocumentRouteTheme(descriptor.relativePath);
  const { pinnedOpen, togglePinned } = useToolbarPinned();
  const [commentsSidebarOpen, setCommentsSidebarOpen] = React.useState(readWordCommentsSidebarOpen);
  // DocxEditor auto-opens the comments sidebar when a document has comments.
  // Accept opens only from comment-related controls — not theme / save / other toolbar clicks.
  const commentsSidebarUserGestureRef = React.useRef(false);
  const colorMode = easyViewThemeToDocxColorMode(themeMode);
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const lifecycle = new ByteEditorLifecycle({
      documentId: descriptor.sessionId, format: 'docx', sourceDiskHash: host.getSourceDiskHash?.(descriptor.sessionId) ?? '',
      root: () => mountRef.current, flushInput() {},
      async serialize(signal) {
        const editor = editorRef.current;
        const model = editor?.getAgent()?.getDocument();
        const live = editor?.getEditorRef()?.getDocument();
        if (!model || !live) throw new Error(tPreview('word.notReadyToSave'));
        const snapshot = structuredClone(model);
        snapshot.package.document.content = structuredClone(live.package.document.content);
        // Serialize an isolated model. DocxEditorRef.save also invokes onSave and
        // clears live change tracking, neither of which belongs in a checkpoint.
        const { DocumentAgent } = await import('@eigenpal/docx-editor-core/agent');
        signal.throwIfAborted();
        return new Uint8Array(await new DocumentAgent(snapshot).toBuffer());
      },
      async restore(bytes, signal) {
        if (!editorRef.current) throw new Error(tPreview('word.notReadyToSave'));
        signal.throwIfAborted();
        // The library promise acknowledges parsing, before React has mounted the
        // replacement ProseMirror view. A capture/SaveAll must await that view.
        let settle!: () => void, fail!: (error: unknown) => void;
        const ready = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
        const pending = { ready: settle, fail };
        restoredViewRef.current = pending;
        const abort = () => fail(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        const timeout = window.setTimeout(() => fail(new Error(tPreview('word.notReadyToSave'))), 30_000);
        try {
          // Observe rejection even if parsing fails before the readiness await.
          void ready.catch(() => {});
          await editorRef.current.loadDocumentBuffer(bytes);
          await ready;
          signal.throwIfAborted();
        } finally {
          clearTimeout(timeout); signal.removeEventListener('abort', abort);
          if (restoredViewRef.current === pending) restoredViewRef.current = null;
        }
      },
    });
    lifecycleRef.current = lifecycle;
    const unsubscribe = lifecycle.subscribe(state => setDirty(state.dirty));
    return () => {
      restoredViewRef.current?.fail(new Error('editor_disposed')); restoredViewRef.current = null;
      if (registeredRef.current?.lifecycle === lifecycle) { registeredRef.current.unregister(); registeredRef.current = null; }
      unsubscribe(); lifecycle.dispose(); if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, [descriptor.sessionId, descriptor.contentUrl, host]);
  const outlineListenersRef = React.useRef(new Set<() => void>());
  const [sidebarHidden, setSidebarHidden] = React.useState(() => !readWordOutlinePinned());
  const toggleSidebar = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarHidden((hidden) => {
      const nextHidden = !hidden;
      writeWordOutlinePinned(!nextHidden);
      return nextHidden;
    });
  }, []);
  const notifyOutline = React.useCallback(() => {
    outlineListenersRef.current.forEach(listener => listener());
  }, []);

  // Minimap pin / sidebar unpin updates prefs inside installWordOutline; keep React toggle in sync.
  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPinned = (event: Event) => {
      const pinned = (event as CustomEvent<{ pinned?: boolean }>).detail?.pinned;
      if (typeof pinned === 'boolean') setSidebarHidden(!pinned);
    };
    mount.addEventListener('easyview-word-outline-pinned', onPinned);
    return () => mount.removeEventListener('easyview-word-outline-pinned', onPinned);
  }, [buffer, loading]);

  React.useEffect(() => {
    const isCommentsControl = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      const el = target.closest('button, [role="button"], [title], [aria-label]');
      if (!el) return false;
      const label = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      return /comment|批注|注释|修订/.test(label);
    };
    const markCommentsGesture = (event: Event) => {
      if (!isCommentsControl(event.target)) return;
      commentsSidebarUserGestureRef.current = true;
      window.setTimeout(() => {
        commentsSidebarUserGestureRef.current = false;
      }, 500);
    };
    window.addEventListener('pointerdown', markCommentsGesture, true);
    window.addEventListener('keydown', markCommentsGesture, true);
    return () => {
      window.removeEventListener('pointerdown', markCommentsGesture, true);
      window.removeEventListener('keydown', markCommentsGesture, true);
    };
  }, []);

  const onCommentsSidebarOpenChange = React.useCallback((open: boolean) => {
    if (open && !commentsSidebarUserGestureRef.current) return;
    setCommentsSidebarOpen(open);
    writeWordCommentsSidebarOpen(open);
  }, []);

  React.useEffect(() => {
    let disposed = false;
    async function boot(): Promise<void> {
      setLoading(true);
      setError(null);
      setDirty(false);
      setSaveMessage(null);
      setBuffer(null);
      try {
        const [{ DocxEditor: Editor }, response] = await Promise.all([
          import('@eigenpal/docx-editor-react'),
          fetch(descriptor.contentUrl),
        ]);
        await import('@eigenpal/docx-editor-react/styles.css');
        // DocxEditor CSS injects after linked preview.css; re-assert left-gutter kill last.
        if (!document.getElementById('easyview-docx-gutter-fix')) {
          const style = document.createElement('style');
          style.id = 'easyview-docx-gutter-fix';
          style.textContent = `
.preview-word-editor .ep-root,
.preview-word-editor .ep-root .docx-editor__scroll-container,
.preview-word-editor .docx-editor__scroll-container,
.preview-word-editor .ep-root .docx-editor-vue__pages-viewport,
.preview-word-editor .docx-editor-vue__pages-viewport {
  scrollbar-gutter: auto !important;
  background: var(--file-viewer-bg, #fff) !important;
  background-color: var(--file-viewer-bg, #fff) !important;
  border-left: 0 !important;
  padding-left: 0 !important;
  margin-left: 0 !important;
}
html, body, .preview-root, .preview-shell, .preview-content, .preview-word-editor {
  margin-left: 0 !important;
  padding-left: 0 !important;
  border-left: 0 !important;
  scrollbar-gutter: auto !important;
}`;
          document.head.appendChild(style);
        }
        if (!response.ok) throw new Error(tPreview('word.readFailed', { status: response.status }));
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength === 0) throw new Error(tPreview('word.emptyDocument'));
        if (disposed) return;
        setDocxEditor(() => Editor as unknown as React.ComponentType<Record<string, unknown>>);
        setBuffer(bytes);
        setLoading(false);
      } catch (reason) {
        if (!disposed) {
          setError(reason);
          setLoading(false);
        }
      }
    }
    void boot();
    return () => { disposed = true; };
  }, [descriptor.contentUrl, descriptor.sessionId]);

  // EasyView outline rail (replaces DocxEditor's floating outline): headings from ProseMirror,
  // re-collected after edits; sits below the formatting bar and shifts the page area right.
  React.useEffect(() => {
    const mount = mountRef.current;
    if (loading || !buffer || !mount) return;
    const viewerRoot = mount.closest<HTMLElement>('.preview-universal-viewer') ?? mount;
    const listeners = outlineListenersRef.current;
    const source = createDocxEditorOutlineSource(
      mount,
      () => editorRef.current as unknown as DocxOutlineEditor | null,
      (onChange) => {
        listeners.add(onChange);
        return () => { listeners.delete(onChange); };
      },
    );
    const controller = installWordOutline(mount, source, wordOutlineLabels());
    const disposeResize = installPreviewSidebarResize(viewerRoot);
    mount.dataset.wordOutline = 'on';
    let scroller: HTMLElement | null = null;
    const place = () => {
      if (!scroller) return;
      const top = scroller.getBoundingClientRect().top - mount.getBoundingClientRect().top;
      mount.style.setProperty('--word-outline-top', `${Math.max(0, Math.round(top))}px`);
    };
    // The scroller's height changes whenever the formatting bar above it does.
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    const watch = () => {
      const next = mount.querySelector<HTMLElement>('.docx-editor__scroll-container');
      if (next === scroller) return;
      if (scroller) resize?.unobserve(scroller);
      scroller = next;
      if (scroller) resize?.observe(scroller);
      place();
      controller.refresh();
    };
    const observer = new MutationObserver(watch);
    observer.observe(mount, { childList: true, subtree: true });
    watch();
    const late = window.setTimeout(place, 300);
    return () => {
      window.clearTimeout(late);
      observer.disconnect();
      resize?.disconnect();
      disposeResize();
      controller.dispose();
      delete mount.dataset.wordOutline;
      mount.style.removeProperty('--word-outline-top');
    };
  }, [buffer, loading]);

  // Inline-beat any remaining left gutter after mount / layout.
  React.useEffect(() => {
    if (loading || !buffer) return;
    const apply = () => {
      document.querySelectorAll<HTMLElement>(
        [
          '.preview-word-editor .docx-editor__scroll-container',
          '.preview-word-editor .docx-editor-vue__pages-viewport',
          '.preview-word-editor .ep-root',
        ].join(','),
      ).forEach((el) => {
        el.style.setProperty('scrollbar-gutter', 'auto', 'important');
        el.style.setProperty('background', 'var(--file-viewer-bg, #fff)', 'important');
        el.style.setProperty('background-color', 'var(--file-viewer-bg, #fff)', 'important');
        el.style.setProperty('border-left', '0', 'important');
        el.style.setProperty('padding-left', '0', 'important');
        el.style.setProperty('margin-left', '0', 'important');
      });
      for (const el of [document.documentElement, document.body]) {
        el.style.setProperty('padding-left', '0', 'important');
        el.style.setProperty('margin-left', '0', 'important');
        el.style.setProperty('scrollbar-gutter', 'auto', 'important');
      }
    };
    apply();
    const timer = window.setTimeout(apply, 50);
    return () => window.clearTimeout(timer);
  }, [buffer, loading, themeMode]);

  const persist = React.useCallback(async (snapshot: import('../editorLifecycle').DraftSnapshot) => {
    if (!host.writeBytes) throw new Error(tPreview('word.saveUnavailable'));
    const result: PreviewWriteResult = host.saveSnapshot ? await host.saveSnapshot(snapshot) : await host.writeBytes(descriptor.sessionId, snapshot.bytes);
    lifecycleRef.current?.acknowledgeSaved(result.savedEditorRevision ?? snapshot.editorRevision, result.diskHash ?? '');
    setSaveMessage(tPreview('common.savedSize', { size: (result.size / 1024).toFixed(result.size >= 10240 ? 0 : 1) }));
    return result;
  }, [descriptor.sessionId, host]);

  const save = React.useCallback(async () => {
    if (saving || host.canSave === false) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const captured = await lifecycleRef.current?.capture(new AbortController().signal);
      if (!captured) throw new Error(tPreview('word.notReadyToSave'));
      await persist(captured);
    } catch (reason) {
      setSaveMessage(reason instanceof Error ? reason.message : tPreview('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [persist, saving, host]);

  React.useEffect(() => {
    const root = mountRef.current;
    if (!root) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopImmediatePropagation(); void save();
      }
    };
    root.addEventListener('keydown', keydown, true);
    return () => root.removeEventListener('keydown', keydown, true);
  }, [save, loading]);

  const exportDocx = React.useCallback(async () => {
    try {
      const captured = await lifecycleRef.current?.capture(new AbortController().signal);
      if (!captured) throw new Error(tPreview('word.notReadyToExport'));
      const blob = new Blob([new Uint8Array(captured.bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = descriptor.fileName.replace(/\.docx$/i, '') + '.docx';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setSaveMessage(reason instanceof Error ? reason.message : tPreview('word.exportFailed'));
    }
  }, [descriptor.fileName]);

  const printDoc = React.useCallback(() => {
    editorRef.current?.print();
  }, []);

  const documentActions = React.useMemo(() => (
    h(React.Fragment, null,
      h('button', {
        type: 'button',
        className: 'preview-chrome-btn preview-chrome-btn--icon',
        title: tPreview('word.exportDocx'),
        'aria-label': tPreview('word.export'),
        disabled: !buffer || saving,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          void exportDocx();
        },
      }, h(DocumentExportIcon, null)),
      h('button', {
        type: 'button',
        className: 'preview-chrome-btn preview-chrome-btn--icon',
        title: tPreview('word.print'),
        'aria-label': tPreview('word.print'),
        disabled: !buffer,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          printDoc();
        },
      }, h(DocumentPrintIcon, null)),
    )
  ), [buffer, exportDocx, printDoc, saving]);

  // Sidebar toggle leads the formatting bar (before undo), like installPreviewSidebarToggle does
  // for @file-viewer toolbars. DocxEditor only appends toolbarExtra, so the button is portaled
  // into a slot kept as the bar's first child.
  const [leadingSlot, setLeadingSlot] = React.useState<HTMLElement | null>(null);
  const editorReady = !loading && !!DocxEditor && !!buffer;
  React.useEffect(() => {
    const mount = mountRef.current;
    if (!editorReady || !mount) return;
    const slot = document.createElement('span');
    slot.className = 'preview-word-leading-actions';
    let bar: HTMLElement | null = null;
    const place = (): void => {
      const next = mount.querySelector<HTMLElement>('[data-testid="formatting-bar"]');
      if (next && next !== bar) {
        bar = next;
        // Bar found: stop watching the (busy) document subtree; the bar observer keeps the slot first.
        mountObserver.disconnect();
        barObserver.disconnect();
        barObserver.observe(next, { childList: true });
      }
      if (bar && bar.firstElementChild !== slot) bar.prepend(slot);
    };
    const barObserver = new MutationObserver(place);
    const mountObserver = new MutationObserver(place);
    mountObserver.observe(mount, { childList: true, subtree: true });
    place();
    setLeadingSlot(slot);
    return () => {
      mountObserver.disconnect();
      barObserver.disconnect();
      slot.remove();
      setLeadingSlot(null);
    };
  }, [editorReady]);

  const sidebarToggle = leadingSlot
    ? createPortal(h('button', {
        type: 'button',
        className: 'preview-chrome-btn preview-chrome-btn--icon preview-word-outline-toggle',
        title: tPreview('toolbar.toggleSidebar'),
        'aria-label': tPreview('toolbar.toggleSidebar'),
        'aria-pressed': !sidebarHidden,
        onClick: toggleSidebar,
        dangerouslySetInnerHTML: { __html: PREVIEW_SIDEBAR_ICON },
      }), leadingSlot)
    : null;

  const toolbarExtra = React.useMemo(() => (
    h(DocumentChromeActions, {
      embedded: true,
      themeMode,
      onCycleTheme: cycleTheme,
      onTogglePinned: togglePinned,
      dirty,
      saving,
      saveDisabled: !buffer || host.canSave === false,
      saveMessage,
      onSave: () => { void save(); },
      documentActions,
    })
  ), [buffer, cycleTheme, dirty, documentActions, save, saveMessage, saving, themeMode, togglePinned]);

  if (error) return h(ViewerError, { error });

  return h(DocumentRouteShell, {
    className: 'preview-word-editor',
    themeMode,
    style: viewerVars,
    'data-ext': extension(descriptor.fileName),
    embedChrome: true,
    pinnedOpen,
    onTogglePinned: togglePinned,
    onCycleTheme: cycleTheme,
  },
    loading || !DocxEditor || !buffer
      ? loadingElement(tPreview('word.loadingEditor'))
      : h('div', {
          className: 'preview-word-mount',
          ref: mountRef,
          'data-preview-sidebar': sidebarHidden ? 'hidden' : 'visible',
          onCompositionStartCapture: () => lifecycleRef.current?.composition(true),
          onCompositionEndCapture: () => lifecycleRef.current?.composition(false),
        },
          sidebarToggle,
          h(DocxEditor, {
            ref: editorRef,
            key: `docx-${descriptor.sessionId}`,
            documentBuffer: buffer,
            mode: 'editing',
            // Display-only mapping from EasyView theme. Never 'system'; no editor-local theme persistence.
            // colorMode updates in place — do not key on it (remount would wipe edits and auto-open comments).
            colorMode,
            showToolbar: true,
            showFileOpen: false,
            showHelpMenu: false,
            showZoomControl: true,
            // EasyView renders its own outline rail (see installWordOutline above).
            showOutline: false,
            showOutlineButton: false,
            showRuler: false,
            // Filename + File/Format/Insert menu row are hidden via CSS; keep a single formatting bar.
            // EasyView chrome is injected into that same formatting-bar via toolbarExtra.
            renderLogo: () => null,
            toolbarExtra,
            author: 'EasyView',
            documentName: descriptor.fileName,
            commentsSidebarOpen,
            onCommentsSidebarOpenChange,
            onEditorViewReady: () => {
              // Readiness callbacks can precede imperative-ref publication in
              // the same React commit. Resolve at the following browser frame.
              const pending = restoredViewRef.current;
              if (pending) requestAnimationFrame(() => {
                if (restoredViewRef.current === pending && editorRef.current?.getEditorRef()?.getDocument()) pending.ready();
              });
              const lifecycle = lifecycleRef.current;
              if (lifecycle && registeredRef.current?.lifecycle !== lifecycle) {
                registeredRef.current?.unregister();
                registeredRef.current = { lifecycle, unregister: host.registerEditor?.(lifecycle) ?? (() => {}) };
              }
            },
            onChange: () => {
              lifecycleRef.current?.changed();
              notifyOutline();
            },
            onError: (err: Error) => setError(err),
            style: { height: '100%', width: '100%' },
          }),
        ),
  );
}
