// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../css-modules.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../x-data-spreadsheet-dist.d.ts" />
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { PreviewWriteResult } from '@easyview/contracts';
import type { XsSpreadsheetFactory, XsSpreadsheetInstance } from '../spreadsheet/xSpreadsheetTypes';
import type { PreviewHost } from '../types';
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
  DocumentRouteShell,
  useDocumentRouteTheme,
  useToolbarPinned,
} from './DocumentRouteChrome';
import { isEditableSpreadsheetFile } from '../spreadsheet/editableFormats';
import {
  applyXSpreadsheetTheme,
  spreadsheetDefaultStyle,
} from '../spreadsheet/spreadsheetTheme';
import { attachSpreadsheetWheelNormalization } from '../spreadsheet/spreadsheetWheel';
import { tPreview } from '../preview.i18n';
import { usePreviewAssets } from '../assets';
import { openSpreadsheetWorker } from '../spreadsheet/spreadsheetWorker';

/** x-data-spreadsheet hardcodes these when computing sheet viewHeight (data_proxy). */
const XS_LIBRARY_TOOLBAR_HEIGHT_PX = 41;
const XS_LIBRARY_BOTTOMBAR_HEIGHT_PX = 41;

export interface SpreadsheetViewerProps extends ViewerProps {
  host?: PreviewHost;
}

/**
 * Map mount size → library view.height() so canvas fills the space between the
 * real CSS toolbar/bottombar (which are shorter, and toolbar may be display:none).
 */
function spreadsheetViewHeight(mount: HTMLElement | null | undefined): number {
  if (!mount) return 600;
  const toolbar = mount.querySelector('.x-spreadsheet-toolbar') as HTMLElement | null;
  const bottombar = mount.querySelector('.x-spreadsheet-bottombar') as HTMLElement | null;
  const toolbarVisible = !!toolbar && getComputedStyle(toolbar).display !== 'none';
  const bottomVisible = !!bottombar && getComputedStyle(bottombar).display !== 'none';
  const toolbarH = toolbarVisible ? toolbar.offsetHeight : 0;
  const bottomH = bottomVisible ? bottombar.offsetHeight : 0;
  // Library always subtracts 41 for each enabled chrome flag (both stay true here).
  return mount.clientHeight - toolbarH - bottomH
    + XS_LIBRARY_TOOLBAR_HEIGHT_PX
    + (bottomVisible ? XS_LIBRARY_BOTTOMBAR_HEIGHT_PX : 0);
}

/**
 * x-spreadsheet draws its icons from a fixed black sprite. Expose that sprite so toolbar
 * styles can use it as a mask and paint icons with the shared toolbar foreground.
 */
export function exposeToolbarIconSprite(toolbar: HTMLElement): void {
  const icon = toolbar.querySelector('.x-spreadsheet-icon-img');
  const sprite = icon ? getComputedStyle(icon).backgroundImage : '';
  if (!sprite.startsWith('url(')) return;
  toolbar.style.setProperty('--x-spreadsheet-icon-sprite', sprite);
  toolbar.classList.add('has-icon-sprite');
}

/**
 * Spreadsheet route:
 * - .xlsx/.xlsm with write host → editable x-spreadsheet (rich toolbar + save)
 * - .xls / .ods / .csv / .tsv / others → UniversalFilePreview (same chrome as PDF)
 */
export function SpreadsheetViewer({ descriptor, host }: SpreadsheetViewerProps): React.ReactElement {
  if (!isEditableSpreadsheetFile(descriptor.fileName) || !host?.writeBytes) {
    return h(UniversalFilePreview, { descriptor, loadingLabel: tPreview('spreadsheet.loadingViewer') });
  }
  return h(SpreadsheetEditor, { descriptor, host });
}

function SpreadsheetEditor({ descriptor, host }: { descriptor: ViewerProps['descriptor']; host: PreviewHost }): React.ReactElement {
  const assets = usePreviewAssets();
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const sheetRef = React.useRef<XsSpreadsheetInstance | null>(null);
  const workbookRef = React.useRef<Awaited<ReturnType<typeof openSpreadsheetWorker>> | null>(null);
  const workingSheets = React.useRef(new Map<number, import('../spreadsheet/xSpreadsheetTypes').XsSheetData>());
  const activeSheet = React.useRef(0);
  const [sheetNames, setSheetNames] = React.useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = React.useState(0);
  const switching = React.useRef(false);
  const generationRef = React.useRef(0);
  const revisionRef = React.useRef(0);
  const [error, setError] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(true);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [chromeSlot, setChromeSlot] = React.useState<HTMLElement | null>(null);
  const { themeMode, cycleTheme, viewerVars } = useDocumentRouteTheme(descriptor.relativePath);
  const { pinnedOpen, togglePinned } = useToolbarPinned();
  const themeModeRef = React.useRef(themeMode);
  themeModeRef.current = themeMode;

  React.useEffect(() => {
    let disposed = false;
    const generation = ++generationRef.current;
    let ownedSpreadsheet: XsSpreadsheetInstance | null = null;
    const releaseSpreadsheet = () => {
      ownedSpreadsheet?.destroy();
      if (sheetRef.current === ownedSpreadsheet) sheetRef.current = null;
      ownedSpreadsheet = null;
    };
    const abort = new AbortController();
    let resizeObserver: ResizeObserver | null = null;
    let detachWheel: (() => void) | null = null;

    async function boot(): Promise<void> {
      setLoading(true);
      setError(null);
      setDirty(false);
      setSaving(false);
      revisionRef.current = 0;
      setSaveMessage(null);
      setChromeSlot(null);
      try {
        const response = await fetch(descriptor.contentUrl, { signal: abort.signal });
        if (!response.ok) throw new Error(tPreview('spreadsheet.readFailed', { status: response.status }));
        const bytes = await response.arrayBuffer();
        if (!assets.spreadsheetWorkerUrl) throw new Error(tPreview('spreadsheet.libraryLoadFailed'));
        const workbook = await openSpreadsheetWorker(bytes, assets.spreadsheetWorkerUrl, abort.signal);
        if (disposed) { workbook.dispose(); return; }
        workbookRef.current = workbook;
        workingSheets.current.clear();
        activeSheet.current = workbook.overview.active;
        setSelectedSheet(workbook.overview.active);
        setSheetNames(workbook.overview.sheets.map(sheet => sheet.name));
        const sheets = [workbook.overview.data];
        if (disposed || !mountRef.current) return;

        const SpreadsheetModule = await import('x-data-spreadsheet/dist/xspreadsheet.js');
        await import('x-data-spreadsheet/dist/xspreadsheet.css');
        if (disposed || !mountRef.current) return;
        if (!document.getElementById('easyview-xlsx-edge-fix')) {
          const style = document.createElement('style');
          style.id = 'easyview-xlsx-edge-fix';
          style.textContent = `
.preview-spreadsheet-editor,
.preview-spreadsheet-mount,
.preview-spreadsheet-editor .x-spreadsheet,
.preview-spreadsheet-editor .x-spreadsheet-sheet,
.preview-spreadsheet-editor .x-spreadsheet-table,
.preview-spreadsheet-editor .x-spreadsheet-overlayer,
.preview-spreadsheet-editor .x-spreadsheet-bottombar,
.preview-spreadsheet-editor .x-spreadsheet-toolbar,
html, body, .preview-root, .preview-shell, .preview-content {
  border-left: 0 !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  scrollbar-gutter: auto !important;
}
.preview-spreadsheet-editor .x-spreadsheet,
.preview-spreadsheet-editor .x-spreadsheet-sheet {
  background: var(--file-viewer-bg, #fff) !important;
}`;
          document.head.appendChild(style);
        }
        const createSpreadsheet = resolveXSpreadsheetFactory(SpreadsheetModule);
        mountRef.current.innerHTML = '';
        const spreadsheet = createSpreadsheet(mountRef.current, {
          mode: 'edit',
          showToolbar: true,
          showGrid: true,
          showContextmenu: true,
          showBottomBar: false,
          style: spreadsheetDefaultStyle(themeModeRef.current),
          view: {
            // Library subtracts fixed 41+41; compensate from measured CSS chrome
            // (toolbar may be collapsed to display:none — fixed 30px math left a bottom gap).
            height: () => spreadsheetViewHeight(mountRef.current),
            width: () => mountRef.current?.clientWidth || 800,
          },
        });
        ownedSpreadsheet = spreadsheet;
        sheetRef.current = spreadsheet;
        spreadsheet.loadData(sheets);
        spreadsheet.change(() => {
          if (!disposed && !switching.current) { revisionRef.current++; setDirty(true); }
        });
        applyXSpreadsheetTheme(spreadsheet, themeModeRef.current);
        detachWheel = attachSpreadsheetWheelNormalization(mountRef.current);

        // Append EasyView chrome after formatting buttons so the whole strip can center as one group.
        const toolbar = mountRef.current.querySelector<HTMLElement>('.x-spreadsheet-toolbar');
        if (toolbar) {
          exposeToolbarIconSprite(toolbar);
          let slot = toolbar.querySelector('[data-easyview-spreadsheet-chrome]') as HTMLElement | null;
          if (!slot) {
            slot = document.createElement('div');
            slot.setAttribute('data-easyview-spreadsheet-chrome', '');
          }
          const btns = toolbar.querySelector('.x-spreadsheet-toolbar-btns');
          if (btns?.nextSibling) toolbar.insertBefore(slot, btns.nextSibling);
          else if (btns) toolbar.appendChild(slot);
          else toolbar.appendChild(slot);
          if (!disposed) setChromeSlot(slot);
        }

        window.setTimeout(() => {
          if (disposed) return;
          spreadsheet.reRender?.();
          window.dispatchEvent(new Event('resize'));
        }, 0);
        resizeObserver = new ResizeObserver(() => {
          if (!disposed) spreadsheet.reRender?.();
        });
        resizeObserver.observe(mountRef.current);
        if (!disposed) setLoading(false);
      } catch (reason) {
        releaseSpreadsheet();
        if (!disposed) {
          setError(reason);
          setLoading(false);
        }
      }
    }

    void boot();
    return () => {
      disposed = true;
      abort.abort();
      workbookRef.current?.dispose(); workbookRef.current = null;
      workingSheets.current.clear();
      detachWheel?.();
      detachWheel = null;
      resizeObserver?.disconnect();
      releaseSpreadsheet();
      if (generationRef.current === generation) generationRef.current++;
      setChromeSlot(null);
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [descriptor.contentUrl, descriptor.sessionId, assets.spreadsheetWorkerUrl]);

  React.useEffect(() => {
    applyXSpreadsheetTheme(sheetRef.current, themeMode);
  }, [themeMode]);

  // Toolbar collapse toggles display:none — remeasure viewHeight so the sheet fills the gap.
  React.useEffect(() => {
    const spreadsheet = sheetRef.current;
    if (!spreadsheet) return;
    const frame = window.requestAnimationFrame(() => {
      if (sheetRef.current !== spreadsheet) return;
      spreadsheet.reRender?.();
      window.dispatchEvent(new Event('resize'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pinnedOpen, descriptor.sessionId]);

  const save = React.useCallback(async () => {
    if (!host.writeBytes || !sheetRef.current || saving) return;
    const spreadsheet = sheetRef.current;
    const generation = generationRef.current;
    const revision = revisionRef.current;
    const sessionId = descriptor.sessionId;
    setSaving(true);
    setSaveMessage(null);
    try {
      const workbook = workbookRef.current;
      if (!workbook) return;
      workingSheets.current.set(activeSheet.current, spreadsheet.getData()[0]);
      const changes = [...workingSheets.current].map(([index, data]) => ({ index, data: structuredClone(data) }));
      const bytes = await workbook.save(changes);
      const result: PreviewWriteResult = await host.writeBytes(sessionId, bytes);
      if (generationRef.current !== generation) return;
      if (revisionRef.current === revision) setDirty(false);
      setSaveMessage(tPreview('common.savedSize', { size: (result.size / 1024).toFixed(result.size >= 10240 ? 0 : 1) }));
    } catch (reason) {
      if (generationRef.current === generation) setSaveMessage(reason instanceof Error ? reason.message : tPreview('common.saveFailed'));
    } finally {
      if (generationRef.current === generation) setSaving(false);
    }
  }, [descriptor.sessionId, host, saving]);

  const switchSheet = async (index: number): Promise<void> => {
    const workbook = workbookRef.current, spreadsheet = sheetRef.current;
    if (!workbook || !spreadsheet || switching.current || index === activeSheet.current) return;
    const generation = generationRef.current;
    workingSheets.current.set(activeSheet.current, structuredClone(spreadsheet.getData()[0]));
    switching.current = true; setLoading(true);
    try {
      const data = workingSheets.current.get(index) ?? await workbook.load(index);
      if (generation !== generationRef.current) return;
      activeSheet.current = index; setSelectedSheet(index);
      spreadsheet.loadData([structuredClone(data)]);
      applyXSpreadsheetTheme(spreadsheet, themeModeRef.current);
    } catch (reason) { if (generation === generationRef.current) setSaveMessage(String(reason)); }
    finally { switching.current = false; if (generation === generationRef.current) setLoading(false); }
  };

  const toolbarChrome = chromeSlot && pinnedOpen
    ? createPortal(
        h(DocumentChromeActions, {
          embedded: true,
          themeMode,
          onCycleTheme: cycleTheme,
          onTogglePinned: togglePinned,
          dirty,
          saving,
          saveMessage,
          onSave: () => { void save(); },
        }),
        chromeSlot,
      )
    : null;

  if (error) return h(ViewerError, { error });

  return h(DocumentRouteShell, {
    className: 'preview-spreadsheet-editor',
    themeMode,
    style: viewerVars,
    'data-ext': extension(descriptor.fileName),
    embedChrome: true,
    pinnedOpen,
    onTogglePinned: togglePinned,
    onCycleTheme: cycleTheme,
  },
    h('div', {
      className: 'preview-spreadsheet-mount',
      ref: mountRef,
      'aria-busy': loading || undefined,
    }),
    h('div', { className: 'preview-spreadsheet-tabs', role: 'tablist' },
      ...sheetNames.map((name, index) => h('button', { key: index, role: 'tab', 'aria-selected': selectedSheet === index, disabled: loading, onClick: () => { void switchSheet(index); } }, name))),
    toolbarChrome,
    loading ? h('div', { className: 'preview-spreadsheet-loading' }, loadingElement(tPreview('spreadsheet.loadingEditor'))) : null,
  );
}


function resolveXSpreadsheetFactory(moduleValue: unknown): XsSpreadsheetFactory {
  const fromWindow = (window as unknown as Window & { x_spreadsheet?: XsSpreadsheetFactory }).x_spreadsheet;
  if (typeof fromWindow === 'function') return fromWindow;

  const mod = moduleValue as { default?: unknown } | XsSpreadsheetFactory | null;
  const candidate = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
  if (typeof candidate === 'function') {
    const fn = candidate as XsSpreadsheetFactory & { prototype?: { loadData?: unknown } };
    if (fn.prototype && typeof fn.prototype.loadData === 'function') {
      return (container, options) => new (fn as unknown as new (el: HTMLElement, opts?: Record<string, unknown>) => XsSpreadsheetInstance)(container, options);
    }
    return fn;
  }
  throw new Error(tPreview('spreadsheet.libraryLoadFailed'));
}
