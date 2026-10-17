import type { Transaction } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { MarkdownSerializerState } from 'prosemirror-markdown';
import { applyTextPatches, minimalTextPatch, type TextOffsetPatch } from '@easyview/editor-sync';
import { docToMarkdown, serializer } from './MarkdownSerializer';

interface StateInternals {
  out: string; closed: Node | null; delim: string; inTightList: boolean; atBlockStart: boolean;
  render(node: Node, parent: Node, index: number): void;
}
interface Chunk { node: Node; context: string; text: string; closed: Node | null }
/** PM persistent nodes provide invalidation at transaction-step granularity.
 * Unchanged top-level nodes retain identity, including undo and redo. The
 * serializer's boundary state is part of the cache key (adjacent lists need
 * different separators). Table metadata has document-wide indexes: full fallback.
 */
export class IncrementalMarkdownSerializer {
  private cache = new WeakMap<Node, Map<string, Chunk>>();
  private previous: Chunk[] = [];
  private tableCache = new WeakMap<Node, boolean>();
  private hasTable(node: Node): boolean {
    const cached = this.tableCache.get(node); if (cached !== undefined) return cached;
    let result = node.type.name === 'table' || node.type.name === 'html_block' || (node.type.name === 'code_block' && /^<\/?(?:td|th|tr)\b/m.test(node.textContent));
    if (!result) node.forEach(child => { if (!result) result = this.hasTable(child); });
    this.tableCache.set(node, result); return result;
  }
  private content = '';
  readonly metrics = { serializedNodes: 0, reusedNodes: 0, fallbacks: 0 };

  /** Step maps identify affected top-level nodes, including appended steps,
   * paste, multi-range edits and history transactions. Persistent identities
   * retain all unaffected serialization entries. */
  observeTransaction(transaction: Transaction): void {
    const ranges: Array<{ from: number; to: number }> = [];
    transaction.mapping.maps.forEach((map, index) => map.forEach((_a, _b, from, to) => {
      const remaining = transaction.mapping.slice(index + 1);
      ranges.push({ from: remaining.map(from, -1), to: remaining.map(to, 1) });
    }));
    // Attribute/mark steps can have empty step maps. Their newly allocated
    // nodes miss the WeakMap naturally; no guessed character offsets are used.
    transaction.doc.forEach((node, offset) => {
      if (ranges.some(range => range.from <= offset + node.nodeSize && range.to >= offset)) this.cache.delete(node);
    });
  }

  reset(): void { this.previous = []; this.content = ''; this.cache = new WeakMap(); }

  serialize(doc: Node, expected: string): { content: string; edits: TextOffsetPatch[] } {
    const global = this.hasTable(doc);
    if (global) {
      const content = docToMarkdown(doc); this.metrics.fallbacks++; this.previous = []; this.content = content;
      return { content, edits: minimalTextPatch(expected, content) };
    }
    const state = new (MarkdownSerializerState as unknown as new (...args: unknown[]) => StateInternals)(serializer.nodes, serializer.marks, { ...serializer.options, tightLists: true });
    const chunks: Chunk[] = [];
    doc.forEach((node, _, index) => {
      const context = `${state.closed?.type.name ?? ''}|${state.out === '' ? 'empty' : state.out.endsWith('\n') ? 'newline' : 'text'}`;
      let variants = this.cache.get(node);
      let chunk = variants?.get(context);
      if (chunk) { this.metrics.reusedNodes++; state.out += chunk.text; state.closed = chunk.closed; }
      else {
        // Use a bounded prefix carrying the only output context the serializer
        // observes at top level. Never copy/scan the full serialized prefix.
        const prefix = state.out === '' ? '' : state.out.endsWith('\n') ? '\n' : 'x';
        state.out = prefix;
        state.render(node, doc, index);
        chunk = { node, context, text: state.out.slice(prefix.length), closed: state.closed };
        if (!variants) { variants = new Map(); this.cache.set(node, variants); }
        variants.set(context, chunk); this.metrics.serializedNodes++;
      }
      // Retain a bounded context; content is assembled once below.
      state.out = chunk.text || state.out;
      chunks.push(chunk);
    });
    const raw = chunks.map(chunk => chunk.text).join('').trimEnd();
    const content = raw ? `${raw}\n` : '';
    let edits: TextOffsetPatch[];
    if (expected !== this.content || this.previous.length === 0) edits = minimalTextPatch(expected, content);
    else {
      let start = 0, endOld = this.previous.length, endNew = chunks.length, offset = 0;
      while (start < endOld && start < endNew && this.previous[start] === chunks[start]) { offset += chunks[start].text.length; start++; }
      while (endOld > start && endNew > start && this.previous[endOld - 1] === chunks[endNew - 1]) { endOld--; endNew--; }
      const old = this.previous.slice(start, endOld).map(chunk => chunk.text).join('');
      const next = chunks.slice(start, endNew).map(chunk => chunk.text).join('');
      edits = minimalTextPatch(old, next).map(edit => ({ ...edit, from: edit.from + offset, to: edit.to + offset }));
    }
    try { if (applyTextPatches(expected, edits) !== content) edits = minimalTextPatch(expected, content); }
    catch { edits = minimalTextPatch(expected, content); }
    this.previous = chunks; this.content = content;
    return { content, edits };
  }
}
