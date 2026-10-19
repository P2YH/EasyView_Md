import { benchmarkStreamingMarkdownTails } from './streaming-markdown-benchmark';
import { performance } from 'node:perf_hooks';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import ExcelJS from 'exceljs';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../packages/editor-core/src/editor/EditorSchema';
import { docToMarkdown } from '../../packages/editor-core/src/editor/lib/MarkdownSerializer';
import { IncrementalMarkdownSerializer } from '../../packages/editor-core/src/editor/lib/IncrementalMarkdownSerializer';
import { IncrementalMarkdown } from '../../packages/editor-core/src/ui/IncrementalMarkdown';
import { hashContent, minimalTextPatch } from '../../packages/editor-sync/src';
import { LazyWorkbook } from '../../packages/preview-ui/src/spreadsheet/lazyWorkbook';
import { workbookBytesToXsSheets } from '../../packages/preview-ui/src/spreadsheet/xSpreadsheetBridge';
import { fingerprintDocument } from '../../apps/desktop/src/main/application/document/documentFileSystem';
const timed = async <T>(fn: () => T | Promise<T>) => { const start = performance.now(); const value = await fn(); return { ms: +(performance.now() - start).toFixed(2), value }; };
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const streaming = [];
for (const repeats of [500, 1000, 2000]) {
  const source = 'Paragraph **bold** with `code` and 中文.\n\n'.repeat(repeats);
  let oldCharacters = 0, oldParses = 0;
  const before = await timed(() => { for (let n = 64; n < source.length + 64; n += 64) { const text = source.slice(0, n); md.render(text); oldCharacters += text.length; oldParses++; } });
  const parser = new IncrementalMarkdown(md);
  const after = await timed(() => { for (let n = 0; n < source.length; n += 64) parser.append(source.slice(n, n + 64)); parser.append('', true); });
  streaming.push({ characters: source.length, chunk: 64, beforeMs: before.ms, afterMs: after.ms, beforeParses: oldParses, beforeParsedCharacters: oldCharacters, after: parser.metrics });
}
const streamingTailGrowth = benchmarkStreamingMarkdownTails();
const paragraphs = Array.from({ length: 5000 }, (_, i) => schema.nodes.paragraph.create(null, schema.text(`Paragraph ${i} ${'plain **words** 中文 '.repeat(10)}`)));
let state = EditorState.create({ doc: schema.nodes.doc.create(null, paragraphs) });
const serializer = new IncrementalMarkdownSerializer(); let current = docToMarkdown(state.doc);
serializer.serialize(state.doc, current);
const transactions = []; for (let i = 0; i < 40; i++) { const tr = state.tr.insertText('x', state.doc.content.size - 2); state = state.apply(tr); transactions.push({ doc: state.doc, tr }); }
const baseline = await timed(() => { let previous = current; for (const { doc } of transactions) { const next = docToMarkdown(doc); minimalTextPatch(previous, next); previous = next; } });
const optimized = await timed(() => { for (const { doc, tr } of transactions) { serializer.observeTransaction(tr); const next = serializer.serialize(doc, current); current = next.content; } });
const hash = await timed(() => { for (let i = 0; i < 40; i++) hashContent(current); });
const cmBefore = await timed(() => { for (let i = 0; i < 100; i++) minimalTextPatch(current, current + 'x'); });
const cmAfter = await timed(() => { for (let i = 0; i < 100; i++) { const patch = [{ from: current.length, to: current.length, insert: 'x' }]; if (patch.length !== 1) throw new Error(); } });
const book = new ExcelJS.Workbook(); for (let s = 0; s < 8; s++) { const sheet = book.addWorksheet(`Sheet ${s + 1}`); for (let r = 1; r <= 300; r++) for (let c = 1; c <= 30; c++) sheet.getCell(r, c).value = r * c + s; }
const bytes = await book.xlsx.writeBuffer(); const input = new Uint8Array(bytes).slice().buffer;
const fullWorkbook = await timed(() => workbookBytesToXsSheets(input));
const lazyWorkbook = await timed(async () => { const session = await LazyWorkbook.open(input); await session.load(session.active); return session; });
const directory = await fs.mkdtemp(path.join(process.cwd(), '.fingerprint-benchmark-')); const file = path.join(directory, 'large.md');
let fingerprint;
try {
  const text = '中文😀 text\n'.repeat(500_000); await fs.writeFile(file, text); const size = (await fs.stat(file)).size;
  const before = await timed(async () => { for (let i = 0; i < 3; i++) hashContent(await fs.readFile(file, 'utf8')); });
  const after = await timed(async () => { for (let i = 0; i < 3; i++) await fingerprintDocument(file); });
  fingerprint = { bytes: size, beforeMs: before.ms, afterMs: after.ms, beforeWholeFileBuffers: 3, afterWholeFileBuffers: 0, streamBufferBytes: 65536, reads: 3 };
} finally { await fs.rm(directory, { recursive: true, force: true }); }
const result = { date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, streaming, streamingTailGrowth, pmSync: { characters: current.length, edits: 40, beforeMs: baseline.ms, afterMs: optimized.ms, hash40Ms: hash.ms, metrics: serializer.metrics }, cmPatch: { edits: 100, beforeMs: cmBefore.ms, afterMs: cmAfter.ms, note: 'Patch calculation only; ChangeSet already holds offsets. Full text/hash remain in the protocol.' }, workbook: { sheets: 8, cellsPerSheet: 9000, beforeMs: fullWorkbook.ms, afterMs: lazyWorkbook.ms, beforeDecoded: 8, afterDecoded: lazyWorkbook.value.metrics.decodedSheets }, fingerprint };
await fs.writeFile('docs/EasyView_second_round_benchmarks_2026-10-17.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
