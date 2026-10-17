import { promises as fs } from 'node:fs';
import { benchmarkStreamingMarkdownTails } from './streaming-markdown-benchmark';
const document = 'docs/EasyView_second_round_benchmarks_2026-10-17.json';
const previous = JSON.parse(await fs.readFile(document, 'utf8'));
previous.streamingTailGrowth = benchmarkStreamingMarkdownTails();
// The old streamingLimits evidence remains labeled as the pre-fix measurement.
if (previous.streamingLimits) { previous.streamingLimitsBeforeTailFix = previous.streamingLimits; delete previous.streamingLimits; }
await fs.writeFile(document, JSON.stringify(previous, null, 2) + '\n');
console.log(JSON.stringify(previous.streamingTailGrowth, null, 2));
