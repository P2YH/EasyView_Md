import { diffSpreadsheets, spreadsheetColumnName, type SpreadsheetRowDiff, type SpreadsheetSheetDiff, type TimelineComparison } from '@easyview/contracts';
import { tTimeline } from './timeline.i18n';

/** DOM budget per pane; larger sheets render a prefix and point to the changed-rows filter. */
const MAX_RENDER_CELLS = 150_000;
const MAX_RENDER_ROWS = 3000;
const MAX_RENDER_COLUMNS = 256;
const ROW_HEIGHT = 22;

type VisibleRow = { kind: 'row'; row: SpreadsheetRowDiff; index: number } | { kind: 'gap'; count: number } | { kind: 'truncated'; count: number };

/** Read-only, side-by-side cell comparison of two workbook versions. */
export class SpreadsheetDiffView {
  private readonly sheets: SpreadsheetSheetDiff[];
  private selected = 0;
  private onlyChanges = false;
  private navigation = -1;
  private readonly tabs = document.createElement('div');
  private readonly summary = document.createElement('span');
  private readonly toggle = document.createElement('input');
  private readonly panes: HTMLElement[] = [];
  private syncing = false;
  private changeAnchors: number[] = [];

  constructor(private readonly root: HTMLElement, comparison: TimelineComparison) {
    installStyles();
    this.sheets = diffSpreadsheets(comparison.spreadsheet!);
    const first = this.sheets.findIndex(sheet => sheet.status !== 'same');
    this.selected = Math.max(0, first);
    root.classList.add('evsd');
    const bar = document.createElement('div'); bar.className = 'evsd-bar';
    const label = document.createElement('span'); label.className = 'evsd-label'; label.textContent = tTimeline('history.readOnlyLabel', { base: comparison.baseLabel, content: comparison.contentLabel });
    const filter = document.createElement('label'); filter.className = 'evsd-filter';
    this.toggle.type = 'checkbox'; this.toggle.onchange = () => { this.onlyChanges = this.toggle.checked; this.render(); };
    filter.append(this.toggle, document.createTextNode(tTimeline('sheet.onlyChanges')));
    bar.append(label, this.summary, filter);
    for (const [text, direction] of [[tTimeline('history.previous'), -1], [tTimeline('history.next'), 1]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = () => this.navigate(direction); bar.append(button);
    }
    this.tabs.className = 'evsd-tabs'; this.tabs.setAttribute('role', 'tablist');
    const body = document.createElement('div'); body.className = 'evsd-body';
    for (const caption of [comparison.baseLabel, comparison.contentLabel]) {
      const side = document.createElement('section'); side.className = 'evsd-side';
      const title = document.createElement('div'); title.className = 'evsd-caption'; title.textContent = caption;
      const pane = document.createElement('div'); pane.className = 'evsd-pane'; pane.tabIndex = 0;
      side.append(title, pane); body.append(side); this.panes.push(pane);
    }
    for (const pane of this.panes) pane.addEventListener('scroll', () => this.syncScroll(pane), { passive: true });
    root.replaceChildren(bar, this.tabs, body);
    this.renderTabs();
    this.render();
  }

  dispose(): void { this.root.classList.remove('evsd'); this.root.replaceChildren(); }

  private renderTabs(): void {
    this.tabs.replaceChildren(...this.sheets.map((sheet, index) => {
      const tab = document.createElement('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.className = `evsd-tab is-${sheet.status}`;
      tab.setAttribute('aria-selected', String(index === this.selected));
      tab.title = sheet.status === 'added' ? tTimeline('sheet.added') : sheet.status === 'removed' ? tTimeline('sheet.removed') : sheet.name;
      const name = document.createElement('span'); name.textContent = sheet.name; tab.append(name);
      if (sheet.changedRows) { const badge = document.createElement('span'); badge.className = 'evsd-badge'; badge.textContent = String(sheet.changedRows); tab.append(badge); }
      tab.onclick = () => { this.selected = index; this.navigation = -1; this.renderTabs(); this.render(); };
      return tab;
    }));
  }

  private render(): void {
    const sheet = this.sheets[this.selected];
    this.toggle.checked = this.onlyChanges;
    const total = this.sheets.reduce((sum, item) => sum + item.changedCells, 0);
    this.summary.textContent = !total ? tTimeline('sheet.noChanges') : sheet ? tTimeline('sheet.summary', { rows: sheet.changedRows, cells: sheet.changedCells }) : '';
    this.navigation = -1;
    if (!sheet) { for (const pane of this.panes) pane.replaceChildren(message(tTimeline('sheet.empty'))); return; }
    const columns = Math.min(sheet.columns, MAX_RENDER_COLUMNS);
    const rows = this.visibleRows(sheet, columns);
    this.changeAnchors = [];
    const changed = (item?: VisibleRow) => item?.kind === 'row' && item.row.status !== 'same';
    rows.forEach((row, index) => { if (changed(row) && !changed(rows[index - 1])) this.changeAnchors.push(index); });
    const widths = columnWidths(sheet, columns);
    this.panes.forEach((pane, side) => {
      const absent = side === 0 ? sheet.status === 'added' : sheet.status === 'removed';
      if (absent) { pane.replaceChildren(message(tTimeline('sheet.absent'))); return; }
      if (!sheet.rows.length) { pane.replaceChildren(message(tTimeline('sheet.empty'))); return; }
      pane.replaceChildren(this.table(rows, columns, widths, side === 0 ? 'base' : 'content'));
      pane.scrollTop = 0; pane.scrollLeft = 0;
    });
  }

  private visibleRows(sheet: SpreadsheetSheetDiff, columns: number): VisibleRow[] {
    const limit = Math.min(MAX_RENDER_ROWS, Math.max(50, Math.floor(MAX_RENDER_CELLS / Math.max(1, columns))));
    const out: VisibleRow[] = [];
    let hidden = 0, rendered = 0;
    for (let index = 0; index < sheet.rows.length; index++) {
      const row = sheet.rows[index];
      if (this.onlyChanges && row.status === 'same') { hidden++; continue; }
      if (hidden) { out.push({ kind: 'gap', count: hidden }); hidden = 0; }
      if (rendered === limit) { out.push({ kind: 'truncated', count: limit }); return out; }
      out.push({ kind: 'row', row, index }); rendered++;
    }
    if (hidden) out.push({ kind: 'gap', count: hidden });
    return out;
  }

  private table(rows: VisibleRow[], columns: number, widths: number[], side: 'base' | 'content'): HTMLTableElement {
    const table = document.createElement('table'); table.className = 'evsd-table';
    const colgroup = document.createElement('colgroup');
    const corner = document.createElement('col'); corner.style.width = '48px'; colgroup.append(corner);
    for (const width of widths) { const col = document.createElement('col'); col.style.width = `${width}px`; colgroup.append(col); }
    const head = document.createElement('thead'); const headRow = document.createElement('tr');
    headRow.append(document.createElement('th'));
    for (let c = 0; c < columns; c++) { const th = document.createElement('th'); th.textContent = spreadsheetColumnName(c); headRow.append(th); }
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const item of rows) {
      const tr = document.createElement('tr');
      if (item.kind !== 'row') {
        tr.className = 'evsd-gap'; const td = document.createElement('td'); td.colSpan = columns + 1;
        td.textContent = item.kind === 'gap' ? tTimeline('sheet.hiddenRows', { count: item.count }) : tTimeline('sheet.truncated', { count: item.count });
        tr.append(td); body.append(tr); continue;
      }
      const { row } = item; const number = row[side];
      tr.className = `is-${row.status}${number === undefined ? ' is-placeholder' : ''}`;
      const th = document.createElement('th'); th.textContent = number === undefined ? '' : String(number + 1); tr.append(th);
      for (let c = 0; c < columns; c++) {
        const cell = row.cells[c]; const td = document.createElement('td');
        if (number !== undefined && cell) {
          td.textContent = cell[side];
          if (cell.status !== 'same') { td.className = side === 'base' ? 'is-old' : 'is-new'; td.title = `${spreadsheetColumnName(c)}${number + 1}: ${cell.base || '∅'} → ${cell.content || '∅'}`; }
          else if (cell[side]) td.title = cell[side];
        }
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(colgroup, head, body);
    return table;
  }

  private syncScroll(source: HTMLElement): void {
    if (this.syncing) return;
    this.syncing = true;
    for (const pane of this.panes) if (pane !== source && pane.firstElementChild?.tagName === 'TABLE') { pane.scrollTop = source.scrollTop; pane.scrollLeft = source.scrollLeft; }
    requestAnimationFrame(() => { this.syncing = false; });
  }

  private navigate(direction: number): void {
    if (!this.changeAnchors.length) return;
    this.navigation = (this.navigation + direction + this.changeAnchors.length) % this.changeAnchors.length;
    const index = this.changeAnchors[this.navigation];
    const pane = this.panes.find(item => item.querySelector('tbody')) ?? this.panes[0];
    const row = pane.querySelectorAll('tbody tr')[index] as HTMLElement | undefined; if (!row) return;
    pane.scrollTop = Math.max(0, row.offsetTop - ROW_HEIGHT * 3);
    this.syncScroll(pane);
    for (const each of this.panes) {
      const target = each.querySelectorAll('tbody tr')[index] as HTMLElement | undefined; if (!target) continue;
      target.classList.remove('is-focused'); void target.offsetWidth; target.classList.add('is-focused');
    }
  }
}

function columnWidths(sheet: SpreadsheetSheetDiff, columns: number): number[] {
  const widths = Array.from({ length: columns }, () => 0);
  const sample = sheet.rows.length > 2000 ? sheet.rows.slice(0, 2000) : sheet.rows;
  for (const row of sample) for (let c = 0; c < columns; c++) {
    const cell = row.cells[c]; if (!cell) continue;
    widths[c] = Math.max(widths[c], textWidth(cell.base), textWidth(cell.content));
  }
  return widths.map(width => Math.min(260, Math.max(64, width + 16)));
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 0xff ? 13 : 7;
  return width;
}

function message(text: string): HTMLElement {
  const element = document.createElement('div'); element.className = 'evsd-message'; element.textContent = text; return element;
}

function installStyles(): void {
  if (document.getElementById('easyview-spreadsheet-diff-styles')) return;
  const style = document.createElement('style'); style.id = 'easyview-spreadsheet-diff-styles';
  style.textContent = `
.evsd{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-size:12px}
.evsd-bar{display:flex;flex:none;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--vscode-panel-border,#444)}
.evsd-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.evsd-bar>span:not(.evsd-label){opacity:.75;white-space:nowrap}
.evsd-filter{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}
.evsd-bar button,.evsd-tab{font:inherit;font-size:12px;color:var(--vscode-editor-foreground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border,#555);border-radius:4px;padding:4px 8px;cursor:pointer}
.evsd-bar button:hover,.evsd-tab:hover{background:var(--vscode-list-hoverBackground,#ffffff16)}
.evsd-tabs{display:flex;flex:none;gap:4px;padding:6px 10px;overflow-x:auto;border-bottom:1px solid var(--vscode-panel-border,#444)}
.evsd-tab{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:2px 8px}
.evsd-tab[aria-selected="true"]{border-color:var(--vscode-focusBorder,#3794ff);background:var(--vscode-list-activeSelectionBackground,#04395e);color:var(--vscode-list-activeSelectionForeground,inherit)}
.evsd-tab.is-added span:first-child{color:var(--vscode-gitDecoration-addedResourceForeground,#3fa266)}
.evsd-tab.is-removed span:first-child{color:var(--vscode-gitDecoration-deletedResourceForeground,#c74e39);text-decoration:line-through}
.evsd-badge{min-width:16px;padding:0 5px;border-radius:8px;text-align:center;font-size:11px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff)}
.evsd-body{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr}
.evsd-side{min-width:0;min-height:0;display:flex;flex-direction:column}
.evsd-side+.evsd-side{border-left:1px solid var(--vscode-panel-border,#444)}
.evsd-caption{flex:none;padding:4px 10px;opacity:.75;border-bottom:1px solid var(--vscode-panel-border,#444)}
.evsd-pane{flex:1;min-height:0;overflow:auto;outline:none}
.evsd-message{padding:24px;opacity:.7;text-align:center}
.evsd-table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:max-content}
.evsd-table th,.evsd-table td{height:${ROW_HEIGHT - 1}px;padding:0 6px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-right:1px solid color-mix(in srgb,currentColor 12%,transparent);border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.evsd-table thead th{position:sticky;top:0;z-index:2;font-weight:400;opacity:1;background:var(--vscode-editorWidget-background,#252526)}
.evsd-table tbody th{position:sticky;left:0;z-index:1;font-weight:400;text-align:right;background:var(--vscode-editorWidget-background,#252526);color:var(--vscode-editorLineNumber-foreground,#858585)}
.evsd-table thead th:first-child{left:0;z-index:3}
.evsd-table tr.is-removed td{background:var(--vscode-diffEditor-removedLineBackground,rgba(255,0,0,.1))}
.evsd-table tr.is-added td{background:var(--vscode-diffEditor-insertedLineBackground,rgba(155,185,85,.12))}
.evsd-table tr.is-modified th{box-shadow:inset 3px 0 var(--vscode-editorGutter-modifiedBackground,#1b81a8)}
.evsd-table tr.is-removed th{box-shadow:inset 3px 0 var(--vscode-editorGutter-deletedBackground,#c74e39)}
.evsd-table tr.is-added th{box-shadow:inset 3px 0 var(--vscode-editorGutter-addedBackground,#487e02)}
.evsd-table td.is-old{background:var(--vscode-diffEditor-removedTextBackground,rgba(255,0,0,.25))}
.evsd-table td.is-new{background:var(--vscode-diffEditor-insertedTextBackground,rgba(155,185,85,.3))}
.evsd-table tr.is-placeholder td{background:repeating-linear-gradient(-45deg,transparent 0 6px,color-mix(in srgb,currentColor 8%,transparent) 6px 7px)}
.evsd-table tr.evsd-gap td{text-align:center;opacity:.65;font-style:italic;background:color-mix(in srgb,currentColor 4%,transparent)}
.evsd-table tr.is-focused td{animation:evsd-flash 1.2s ease-out}
@keyframes evsd-flash{from{box-shadow:inset 0 0 0 1px var(--vscode-focusBorder,#3794ff)}to{box-shadow:none}}
`;
  document.head.append(style);
}
