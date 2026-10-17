import MarkdownIt from 'markdown-it';
import { StreamingMarkdownTail, STREAMING_ROW_LIMIT, streamingTailHtml, type StreamingTailView } from './StreamingMarkdownTail';
import type Token from 'markdown-it/lib/token.mjs';

type References = Record<string, { href: string; title: string }>;
interface Block { source: string; tokens: Token[]; html: string }
export interface MarkdownUpdate { stable: readonly Block[]; tail: string; invalidated: boolean; tailView?: StreamingTailView }

/** Append-only Markdown. Keep the last top-level construct open, including entire
 * lists/quotes/tables/fences. Only blank-line-separated top-level boundaries are
 * committed. Reference definitions invalidate inline rendering, not block parsing.
 * No synthetic closing fence: markdown-it already renders open fences correctly. */
export class IncrementalMarkdown {
  private source = '';
  private pending = '';
  private blocks: Block[] = [];
  private references: References = {};
  private referenceKey = '';
  private streamingTail?: StreamingMarkdownTail;
  private lastUpdate?: MarkdownUpdate;
  readonly metrics = { parses: 0, parsedCharacters: 0, committedBlocks: 0, referenceRenders: 0, tailScannedCharacters: 0, checkpointParses: 0, domCharacters: 0 };
  constructor(private readonly markdown: MarkdownIt) {}

  append(delta: string, final = false): MarkdownUpdate {
    if (!delta && !final && this.lastUpdate) return this.lastUpdate;
    this.source += delta;
    this.pending += delta;
    return this.lastUpdate = this.render(final, false, delta);
  }
  update(source: string, final = false): MarkdownUpdate {
    let invalidated = false;
    if (!source.startsWith(this.source)) {
      this.pending = ''; this.blocks = []; this.references = {}; this.referenceKey = ''; this.source = ''; this.streamingTail = undefined; invalidated = true;
    }
    const delta = source.slice(this.source.length);
    if (!delta && !final && !invalidated && this.lastUpdate) return this.lastUpdate;
    this.pending += delta;
    this.source = source;
    return this.lastUpdate = this.render(final, invalidated, delta);
  }
  private render(final: boolean, invalidated = false, delta = ''): MarkdownUpdate {
    const tail = this.pending;
    if (!final && tail.length > STREAMING_ROW_LIMIT) {
      if (this.streamingTail) this.streamingTail.append(delta);
      else this.streamingTail = new StreamingMarkdownTail(this.markdown, tail, { references: { ...this.references } }, this.metrics);
      return { stable: this.blocks, tail: '', invalidated, tailView: this.streamingTail.view };
    }
    this.streamingTail = undefined;
    const env = { references: { ...this.references } };
    this.metrics.parses++; this.metrics.parsedCharacters += tail.length;
    const tokens = this.markdown.parse(tail, env);
    const referenceKey = JSON.stringify(env.references);
    if (referenceKey !== this.referenceKey) {
      // Definitions may occur after their uses, including shortcut/image refs.
      // Re-run inline/core rules for the dependent cached blocks only.
      for (const block of this.blocks) {
        if (!block.source.includes('[')) continue;
        const state = new this.markdown.core.State(block.source, this.markdown, env);
        state.tokens = block.tokens;
        for (const token of state.tokens) if (token.type === 'inline') token.children = [];
        const rules = this.markdown.core.ruler.getRules('');
        // normalize/block have already run; retain the cached block token tree.
        for (const rule of rules.slice(2)) rule(state);
        block.html = this.markdown.renderer.render(state.tokens, this.markdown.options, env);
        this.metrics.referenceRenders++;
      }
      this.referenceKey = referenceKey; invalidated = true;
    }
    // Global references from committed blocks are immutable. Tail definitions
    // are deliberately not persisted until their containing region is committed.
    const starts: number[] = [];
    for (let i = 0; i < tokens.length; i++) if (tokens[i].level === 0 && tokens[i].map && tokens[i].nesting !== -1) starts.push(i);
    const lines = tail.split('\n');
    const offsets = [0];
    for (let i = 0; i < lines.length - 1; i++) offsets.push(offsets[i] + lines[i].length + 1);
    let boundary = final ? tail.length : 0;
    if (!final) {
      for (let k = starts.length - 1; k > 0; k--) {
        const line = tokens[starts[k]].map![0];
        // A blank line prevents a partial heading/list marker from later
        // merging into the preceding paragraph. Never split nested tokens.
        if (line > 0 && lines[line - 1].trim() === '' && line < lines.length - 1) {
          boundary = offsets[line]; break;
        }
      }
    }
    if (boundary > 0) {
      const committed = tail.slice(0, boundary);
      // Block parse once for the committed region to obtain its own definitions;
      // render using all references visible in the current reply.
      const committedEnv = { references: { ...this.references } };
      this.metrics.parses++; this.metrics.parsedCharacters += committed.length;
      const committedTokens = this.markdown.parse(committed, committedEnv);
      const roots = committedTokens.flatMap((token, index) => token.level === 0 && token.map && token.nesting !== -1 ? [index] : []);
      for (let index = 0; index < roots.length; index++) {
        const start = roots[index], end = roots[index + 1] ?? committedTokens.length;
        const from = offsets[committedTokens[start].map![0]];
        const to = roots[index + 1] === undefined ? committed.length : offsets[committedTokens[end].map![0]];
        const source = committed.slice(from, to);
        const state = new this.markdown.core.State(source, this.markdown, env);
        state.tokens = committedTokens.slice(start, end);
        for (const token of state.tokens) if (token.type === 'inline') token.children = [];
        for (const rule of this.markdown.core.ruler.getRules('').slice(2)) rule(state);
        this.blocks.push({ source, tokens: state.tokens, html: this.markdown.renderer.render(state.tokens, this.markdown.options, env) });
        this.metrics.committedBlocks++;
      }
      this.references = committedEnv.references;
      this.pending = tail.slice(boundary);
    }
    // Closing tokens lack maps; slice by the top-level opening instead.
    const tailIndex = tokens.findIndex(token => token.level === 0 && token.map && offsets[token.map[0]] >= boundary);
    const html = boundary === 0 ? this.markdown.renderer.render(tokens, this.markdown.options, env)
      : boundary === tail.length ? '' : this.markdown.renderer.render(tailIndex < 0 ? [] : tokens.slice(tailIndex), this.markdown.options, env);
    return { stable: this.blocks, tail: html, invalidated };
  }

  html(source: string, final = false): string {
    const result = this.update(source, final);
    return result.stable.map(block => block.html).join('') + (result.tailView ? streamingTailHtml(result.tailView, this.markdown.utils.escapeHtml) : result.tail);
  }
}
