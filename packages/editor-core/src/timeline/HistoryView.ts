import type { TimelineComparison } from '@easyview/contracts';
import { ChangeViewController, type PreparedHistoryDiff } from '../controllers/ChangeViewController';
/** A transient, isolated Change surface. No host transport or write-capable editor is mounted. */
export class HistoryView {
  private controller?: ChangeViewController;
  private worker?: Worker;
  private destroyed = false;
  private workerFetch = new AbortController();
  private workerObjectUrl?: string;
  private workerDeadline?: ReturnType<typeof setTimeout>;
  private navigationIndex = -1;
  constructor(private readonly root: HTMLElement, private comparison: TimelineComparison | null, workerUrl: string) {
    root.classList.add('easyview-history-view');
    if (!comparison) throw new Error('历史比较内容不存在');
    const bar = document.createElement('div'); bar.className = 'easyview-history-toolbar';
    if (!document.getElementById('easyview-history-styles')) { const style = document.createElement('style'); style.id = 'easyview-history-styles'; style.textContent = '.easyview-history-toolbar button,.easyview-history-toolbar select{font:inherit;font-size:12px;color:var(--vscode-editor-foreground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border,#555);border-radius:4px;padding:4px 8px}.easyview-history-toolbar button{cursor:pointer}.easyview-history-toolbar button:hover{background:var(--vscode-list-hoverBackground,#ffffff16)}'; document.head.append(style); }
    bar.style.cssText = 'display:flex;gap:12px;padding:10px;align-items:center;flex:0 0 auto;border-bottom:1px solid var(--vscode-panel-border,#444)';
    const label = document.createElement('span'); label.style.flex = '1'; label.textContent = `${comparison.baseLabel} → ${comparison.contentLabel} · 只读`;
    bar.append(label);
    const scrollArea = document.createElement('div'); scrollArea.style.cssText = 'position:relative;flex:1;min-height:0;overflow:auto';
    const placeholder = document.createElement('div'); placeholder.textContent = '正在计算版本差异…'; scrollArea.append(placeholder);
    root.style.cssText = 'height:100%;min-height:0;display:flex;flex-direction:column'; root.replaceChildren(bar, scrollArea);
    for (const [text, direction] of [['上一处', -1], ['下一处', 1]] as const) {
      const button = document.createElement('button'); button.textContent = text;
      button.onclick = () => {
        const hunks = this.diff?.hunks ?? []; if (!hunks.length) return;
        this.navigationIndex = (this.navigationIndex + direction + hunks.length) % hunks.length;
        this.controller?.scrollToLine(Math.max(1, hunks[this.navigationIndex].newStart));
      };
      bar.append(button);
    }
    void this.startWorker(workerUrl, placeholder, bar, scrollArea);
  }
  private async startWorker(workerUrl: string, placeholder: HTMLElement, bar: HTMLElement, scrollArea: HTMLElement): Promise<void> {
    try {
    const response = await fetch(workerUrl, { signal: this.workerFetch.signal });
    if (!response.ok) throw new Error('无法加载差异计算 worker');
    const source = await response.text();
    if (this.destroyed || !this.comparison) return;
    this.workerObjectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(this.workerObjectUrl); this.worker = worker;
    this.workerDeadline = setTimeout(() => { placeholder.textContent = '版本差异计算超时，已停止计算以保护应用响应'; this.stopWorker(); }, 5000);
    worker.onerror = () => { placeholder.textContent = '版本差异计算失败'; this.stopWorker(); };
    worker.onmessage = (event: MessageEvent<PreparedHistoryDiff>) => {
      if (this.destroyed || !this.comparison) return;
      if ('error' in event.data) { placeholder.textContent = String(event.data.error); this.stopWorker(); return; }
      this.diff = event.data; this.stopWorker(); placeholder.textContent = '';
      this.controller = new ChangeViewController({
        scrollArea, editorElement: placeholder, currentContent: () => this.comparison!.content,
        getBaseContent: () => this.comparison!.base, readOnly: true, preparedDiff: event.data,
        setContent: () => { throw new Error('历史视图只读'); }, postEdit: () => { throw new Error('历史视图只读'); }, stageHunk: () => { throw new Error('历史视图只读'); },
        onStateChange: () => undefined, getVisibleSourceAnchor: () => ({ line: 1, offsetFromTop: 0 }), revealSourceAnchor: () => undefined,
      });
      this.controller.open();
      const outline = document.createElement('select'); outline.setAttribute('aria-label', '历史文档目录');
      const defaultOption = document.createElement('option'); defaultOption.textContent = '文档目录'; defaultOption.value = ''; outline.append(defaultOption);
      for (const [index, line] of this.comparison.content.split('\n').entries()) {
        const heading = /^(#{1,6})\s+(.+)$/.exec(line); if (!heading) continue;
        const option = document.createElement('option'); option.value = String(index + 1); option.textContent = heading[2]; outline.append(option);
      }
      outline.onchange = () => { if (outline.value) this.controller?.scrollToLine(Number(outline.value)); };
      bar.append(outline);
    };
    worker.postMessage({ base: this.comparison.base, content: this.comparison.content });
    } catch (error) { if (!this.destroyed) { placeholder.textContent = error instanceof Error ? error.message : String(error); this.stopWorker(); } }
  }
  private diff?: PreparedHistoryDiff;
  private stopWorker(): void { if (this.workerDeadline) { clearTimeout(this.workerDeadline); this.workerDeadline = undefined; } if (this.workerObjectUrl) { URL.revokeObjectURL(this.workerObjectUrl); this.workerObjectUrl = undefined; } if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = undefined; } }
  dispose(): void { this.destroyed = true; this.workerFetch.abort(); this.stopWorker(); this.controller?.dispose(); this.controller = undefined; this.diff = undefined; this.comparison = null; this.root.replaceChildren(); }
}
