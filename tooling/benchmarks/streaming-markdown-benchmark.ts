import { performance } from 'node:perf_hooks';
import MarkdownIt from 'markdown-it';
import { IncrementalMarkdown } from '../../packages/editor-core/src/ui/IncrementalMarkdown';
import { longStructure, STREAMING_FIXTURE_KINDS } from '../../packages/editor-core/src/ui/StreamingMarkdownTail.fixtures';
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const chunk = 64;
function incremental(source: string) {
  const parser = new IncrementalMarkdown(md);
  for (let offset = 0; offset < source.length; offset += chunk) parser.append(source.slice(offset, offset + chunk));
  parser.append('', true);
  return parser;
}
function elapsed(fn: () => unknown): number { const start = performance.now(); fn(); return performance.now() - start; }
function median(values: number[]): number { return +values.sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3); }
export function benchmarkStreamingMarkdownTails() {
  const growth = [];
  // Warm the same code paths before measuring; optimized timings are medians of
  // seven runs, baseline is one entire stream, and count includes finalization.
  const scenarios = [
    ...STREAMING_FIXTURE_KINDS.map(kind => ({ kind, source: (size: number) => longStructure(kind, size) })),
    { kind: 'fence-single-line', source: (size: number) => '```text\n' + 'x'.repeat(size - 8) },
  ];
  for (const { kind, source: makeSource } of scenarios) {
    incremental(makeSource(8000));
    for (const characters of [20000, 40000, 80000]) {
      const source = makeSource(characters);
      let beforeParsedCharacters = 0, beforeParses = 0;
      const beforeMs = elapsed(() => {
        for (let end = chunk; end < source.length + chunk; end += chunk) {
          const prefix = source.slice(0, end); md.render(prefix); beforeParsedCharacters += prefix.length; beforeParses++;
        }
      });
      const afterMs = median(Array.from({ length: 7 }, () => elapsed(() => incremental(source))));
      const parser = incremental(source);
      if (parser.html(source, true) !== md.render(source)) throw new Error(`${kind} final HTML mismatch`);
      growth.push({ kind, characters, chunk, beforeMs: +beforeMs.toFixed(3), afterMs, beforeParses, beforeParsedCharacters, after: { ...parser.metrics } });
    }
  }
  return { date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, optimizedRuns: 7, timings: 'optimized median; baseline single run; parsing and HTML generation, no DOM', growth };
}
