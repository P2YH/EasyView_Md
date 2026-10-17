import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/** A physical row is reparsed only while bounded by this size. Larger or
 * context-dependent constructs use geometric checkpoints plus literal appends. */
export const STREAMING_ROW_LIMIT = 1024;
export interface TailRow { html: string; loose?: string }
export interface StreamingTailView {
  kind: 'rows' | 'text' | 'checkpoint';
  frame: string;
  target: string;
  rows: TailRow[];
  active: string;
  loose: boolean;
  revision: number;
}
type Mode = 'fence' | 'list' | 'quote' | 'table' | 'checkpoint';
type Environment = { references: Record<string, { href: string; title: string }> };
interface Counter { parses: number; parsedCharacters: number; tailScannedCharacters: number; checkpointParses: number }

/** Streaming inside one open top-level construct. The scanner consumes each
 * source character once. Flat list items/table rows have independent Markdown
 * tokenization; plain quote lines and fenced code have append-only payloads.
 * Context changes fall back once, then snapshots double in size: total full
 * reparsing and DOM replacement remain bounded by a geometric series. */
export class StreamingMarkdownTail {
  readonly view: StreamingTailView = { kind: 'rows', frame: '', target: '', rows: [], active: '', loose: false, revision: 0 };
  private mode: Mode = 'checkpoint';
  private source = '';
  private line = '';
  private lastCR = false;
  private prefix = '';
  private fence = '';
  private fenceIndent = 0;
  private fenceCandidate = true;
  private code = '';
  private codeLineStart = true;
  private listMarker = '';
  private blank = false;
  private quotePrevious = '';
  private tableHeader = '';
  private tableDelimiter = '';
  private nextCheckpoint = 0;
  private fenceRun = 0;
  private fenceLeading = 0;
  private fenceTrailing = false;
  private readonly initialReferences: Environment['references'];
  private raw = '';

  constructor(private md: MarkdownIt, initial: string, private env: Environment, private count: Counter) {
    this.initialReferences = { ...env.references };
    const firstEnd = initial.indexOf('\n');
    const first = firstEnd < 0 ? initial : initial.slice(0, firstEnd).replace(/\r$/, '');
    const fence = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(first);
    const list = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(\S.*)$/.exec(first);
    const secondEnd = firstEnd < 0 ? -1 : initial.indexOf('\n', firstEnd + 1);
    const second = secondEnd < 0 ? '' : initial.slice(firstEnd + 1, secondEnd).replace(/\r$/, '');
    if (firstEnd >= 0 && first.length <= STREAMING_ROW_LIMIT && fence && (fence[2][0] !== '`' || !fence[3].includes('`'))) {
      this.mode = 'fence'; this.fence = fence[2]; this.fenceIndent = fence[1].length;
      this.view.kind = 'text'; this.view.frame = this.render(`${first}\n`); this.view.target = 'code';
      this.source = initial.slice(0, firstEnd + 1);
      this.append(initial.slice(firstEnd + 1));
      return;
    }
    if (list && first.length <= STREAMING_ROW_LIMIT) {
      const tokens = this.parse(first + '\n');
      if (['bullet_list_open', 'ordered_list_open'].includes(tokens[0]?.type)) {
        this.mode = 'list'; this.prefix = list[1]; this.listMarker = list[2].replace(/\d+/, '');
        this.view.frame = this.md.renderer.renderToken(tokens, 0, md.options) + this.md.renderer.renderToken(tokens, tokens.length - 1, md.options);
        this.view.target = tokens[0].tag;
      }
    } else if (/^ {0,3}>/.test(first)) {
      this.mode = 'quote'; this.view.frame = '<blockquote>\n<p></p>\n</blockquote>\n'; this.view.target = 'p';
    } else if (firstEnd >= 0 && secondEnd >= 0 && first.length + second.length < STREAMING_ROW_LIMIT) {
      const tokens = this.parse(first + '\n' + second + '\n');
      if (tokens[0]?.type === 'table_open') {
        this.mode = 'table'; this.tableHeader = first; this.tableDelimiter = second;
        this.view.frame = this.md.renderer.render(tokens, md.options, env).replace('</table>', '<tbody></tbody>\n</table>');
        this.view.target = 'tbody';
        this.source = initial.slice(0, secondEnd + 1);
        this.append(initial.slice(secondEnd + 1)); return;
      }
    }
    if (this.isCheckpoint()) { this.source = initial; this.checkpoint(); }
    else this.append(initial);
  }
  private isCheckpoint(): boolean { return this.mode === 'checkpoint'; }
  private parse(text: string): Token[] { this.count.parses++; this.count.parsedCharacters += text.length; return this.md.parse(text, this.env); }
  private render(text: string): string { return this.md.renderer.render(this.parse(text), this.md.options, this.env); }

  append(delta: string): StreamingTailView {
    this.source += delta;
    if (this.isCheckpoint()) { this.appendRaw(delta); this.maybeCheckpoint(); return this.view; }
    for (let index = 0; index < delta.length; index++) {
      let char = delta[index]; this.count.tailScannedCharacters++;
      if (this.lastCR && char === '\n') { this.lastCR = false; continue; }
      this.lastCR = char === '\r';
      if (char === '\r') char = '\n';
      if (char === '\0') char = '\uFFFD';
      this.line += char;
      if (this.mode === 'fence') {
        this.fenceCharacter(char);
      } else if (char === '\n') {
        const line = this.line.slice(0, -1); this.line = '';
        if (!this.completeLine(line)) { this.defer(); break; }
      } else if (this.line.length > STREAMING_ROW_LIMIT) { this.defer(); break; }
      if (this.isCheckpoint()) break;
    }
    if (this.isCheckpoint()) return this.view;
    if (this.mode === 'fence') {
      let active = this.fenceCandidate ? this.fencePreview() : this.line;
      if (this.codeLineStart && this.fenceIndent) active = active.replace(new RegExp(`^ {0,${this.fenceIndent}}`), '');
      this.view.active = this.code + active;
    }
    else this.previewLine();
    return this.view;
  }
  private completeLine(line: string): boolean {
    if (this.mode === 'list') {
      if (!line.trim()) { this.blank = true; return true; }
      const item = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(\S.*)$/.exec(line);
      if (!item || item[1] !== this.prefix || item[2].replace(/\d+/, '') !== this.listMarker || /^\[[^\]]+\]:/.test(item[4])) return false;
      const row = this.listRow(line); if (!row) return false;
      if (this.blank) { this.view.loose = true; this.blank = false; }
      this.view.rows.push(row); return true;
    }
    if (this.mode === 'quote') {
      const html = this.quoteLine(line); if (html === null) return false;
      if (this.quotePrevious) this.view.rows.push({ html: this.quotePrevious + '<br>\n' });
      this.quotePrevious = html; return true;
    }
    if (this.mode === 'table') {
      const row = this.tableRow(line); if (row === null) return false;
      this.view.rows.push({ html: row }); return true;
    }
    return false;
  }
  private listRow(line: string): TailRow | null {
    const tokens = this.parse(line + '\n');
    if (!['bullet_list_open', 'ordered_list_open'].includes(tokens[0]?.type) || tokens[1]?.type !== 'list_item_open') return null;
    const content = tokens.slice(1, -1);
    const html = this.md.renderer.render(content, this.md.options, this.env);
    for (const token of content) if (token.type === 'paragraph_open' || token.type === 'paragraph_close') token.hidden = false;
    return { html, loose: this.md.renderer.render(content, this.md.options, this.env) };
  }
  private quoteLine(line: string): string | null {
    // Inline delimiters can match across physical lines. Only proven literal
    // paragraphs are sealed; rich/nested/lazy quote continuation is checkpointed.
    if (!/^ {0,3}>/.test(line) || /[*_~`\\[!<&:@]/.test(line)) return null;
    const tokens = this.parse(line + '\n');
    if (tokens.length !== 5 || tokens[1]?.type !== 'paragraph_open' || tokens[2]?.type !== 'inline') return null;
    return this.md.renderer.renderInline(tokens[2].children ?? [], this.md.options, this.env);
  }
  private tableRow(line: string): string | null {
    if (!/^ {0,3}\|/.test(line) || !line.trim()) return null;
    const tokens = this.parse(`${this.tableHeader}\n${this.tableDelimiter}\n${line}\n`);
    const tbody = tokens.findIndex(token => token.type === 'tbody_open');
    const end = tokens.findIndex(token => token.type === 'tbody_close');
    if (tbody < 0 || end < 0 || tokens.at(-1)?.type !== 'table_close') return null;
    return this.md.renderer.render(tokens.slice(tbody + 1, end), this.md.options, this.env);
  }
  private previewLine(): void {
    if (this.mode === 'list') {
      const row = this.line.trim() ? this.listRow(this.line) : null;
      if (row && this.blank) this.view.loose = true;
      this.view.active = row ? (this.view.loose ? row.loose! : row.html) : '';
    } else if (this.mode === 'table') this.view.active = this.line.trim() ? this.tableRow(this.line) ?? '' : '';
    else {
      const next = this.line.trim() ? this.quoteLine(this.line) : null;
      this.view.active = this.quotePrevious + (next ? '<br>\n' + next : '');
    }
  }
  private fencePreview(): string {
    return this.fenceCandidate && this.fenceRun >= this.fence.length ? '' : this.line;
  }
  private fenceCharacter(char: string): void {
    if (char === '\n') {
      if (this.fenceCandidate && this.fenceRun >= this.fence.length) { this.defer(); return; }
      this.appendCode(this.line); this.line = ''; this.fenceCandidate = true;
      this.fenceRun = 0; this.fenceLeading = 0; this.fenceTrailing = false;
    } else if (this.fenceCandidate) {
      if (char === ' ' && this.fenceRun === 0 && this.fenceLeading < 3) this.fenceLeading++;
      else if (char === this.fence[0] && !this.fenceTrailing) this.fenceRun++;
      else if ((char === ' ' || char === '\t') && this.fenceRun >= this.fence.length) this.fenceTrailing = true;
      else this.fenceCandidate = false;
    }
    if (!this.fenceCandidate && this.line.length >= STREAMING_ROW_LIMIT) {
      this.appendCode(this.line); this.line = '';
    }
  }
  private appendCode(text: string): void {
    // Remove the opening fence indentation from each code line, matching the
    // block parser. Fragmented physical lines only strip indentation once.
    if (this.codeLineStart && this.fenceIndent) text = text.replace(new RegExp(`^ {0,${this.fenceIndent}}`), '');
    this.codeLineStart = text.endsWith('\n');
    this.code += text;
    while (this.code.length >= STREAMING_ROW_LIMIT) {
      const end = textChunkEnd(this.code);
      this.view.rows.push({ html: this.code.slice(0, end) });
      this.code = this.code.slice(end);
    }
  }
  private defer(): void { this.mode = 'checkpoint'; this.checkpoint(); }
  private checkpoint(): void {
    this.count.checkpointParses++;
    this.env.references = { ...this.initialReferences };
    this.view.kind = 'checkpoint'; this.view.frame = this.render(this.source);
    this.view.rows = []; this.view.active = ''; this.view.revision++;
    this.raw = '';
    this.nextCheckpoint = Math.max(STREAMING_ROW_LIMIT * 2, this.source.length * 2);
  }
  private maybeCheckpoint(): void { if (this.source.length >= this.nextCheckpoint) this.checkpoint(); }
  private appendRaw(delta: string): void {
    this.raw += delta;
    while (this.raw.length >= STREAMING_ROW_LIMIT) {
      const end = textChunkEnd(this.raw);
      this.view.rows.push({ html: this.raw.slice(0, end) }); this.raw = this.raw.slice(end);
    }
    this.view.active = this.raw;
  }
}

/** HTML inspection is proportional to output size; the live UI consumes the
 * row/text view directly and never joins all preceding rows on append. */
export function streamingTailHtml(view: StreamingTailView, escape: (text: string) => string): string {
  const text = view.kind !== 'rows';
  const render = (value: string) => text ? escape(value) : value;
  const payload = view.rows.map(row => render(view.loose ? row.loose ?? row.html : row.html)).join('') + render(view.active);
  if (view.kind === 'checkpoint') return view.frame + `<span style="white-space: pre-wrap;">${payload}</span>`;
  return view.frame.replace(`</${view.target}>`, `${payload}</${view.target}>`);
}

function textChunkEnd(text: string): number {
  const last = text.charCodeAt(STREAMING_ROW_LIMIT - 1);
  return last >= 0xD800 && last <= 0xDBFF ? STREAMING_ROW_LIMIT - 1 : STREAMING_ROW_LIMIT;
}
