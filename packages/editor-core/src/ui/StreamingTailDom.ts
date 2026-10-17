import type { StreamingTailView, TailRow } from './StreamingMarkdownTail';

/** DOM work follows the same bounded chunks as parsing. Never assign the full
 * growing tail to innerHTML on ordinary appends. Full replacements occur only
 * at geometric checkpoints, a mode transition, and canonical finalization. */
export class StreamingTailDom {
  private view?: StreamingTailView;
  private revision = -1;
  private target?: HTMLElement;
  private rows: Node[][] = [];
  private active: Node[] = [];
  private activeValue = '';
  private loose = false;
  private anchor = document.createComment('stream-tail');
  constructor(private root: HTMLElement, private decorate: (root: HTMLElement) => void, private metrics: { domCharacters: number }) {}

  render(view: StreamingTailView): void {
    if (this.view !== view || this.revision !== view.revision) {
      this.root.innerHTML = view.frame; this.metrics.domCharacters += view.frame.length;
      this.view = view; this.revision = view.revision; this.rows = []; this.active = []; this.activeValue = '';
      this.loose = view.loose; this.anchor = document.createComment('stream-tail');
      if (view.kind === 'checkpoint') {
        this.target = document.createElement('span'); this.target.style.whiteSpace = 'pre-wrap'; this.root.append(this.target);
      } else this.target = this.root.querySelector<HTMLElement>(view.target)!;
      this.target.append(this.anchor); this.decorate(this.root);
    }
    const target = this.target!;
    const text = view.kind !== 'rows';
    if (this.loose !== view.loose) {
      for (let i = 0; i < this.rows.length; i++) {
        const previous = this.rows[i], next = this.nodes(view.rows[i], target, text, view.loose);
        for (const node of next) target.insertBefore(node, previous[0] ?? this.anchor);
        for (const node of previous) node.parentNode?.removeChild(node);
        this.rows[i] = next;
      }
      this.loose = view.loose;
    }
    for (let i = this.rows.length; i < view.rows.length; i++) {
      const nodes = this.nodes(view.rows[i], target, text, view.loose);
      for (const node of nodes) target.insertBefore(node, this.active[0] ?? this.anchor);
      this.rows.push(nodes);
    }
    if (this.activeValue !== view.active) {
      for (const node of this.active) node.parentNode?.removeChild(node);
      this.active = this.nodes({ html: view.active }, target, text, false);
      for (const node of this.active) target.insertBefore(node, this.anchor);
      this.activeValue = view.active;
    }
  }
  private nodes(row: TailRow, target: HTMLElement, text: boolean, loose: boolean): Node[] {
    const content = loose ? row.loose ?? row.html : row.html;
    this.metrics.domCharacters += content.length;
    if (!content) return [];
    if (text) return [document.createTextNode(content)];
    const holder = document.createElement(target.tagName);
    holder.innerHTML = content; this.decorate(holder);
    return [...holder.childNodes];
  }
}
