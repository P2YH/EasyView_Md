// i18n-ignore-file: deterministic Unicode parser fixtures, not UI copy.
/** Shared deterministic long-structure corpus for correctness and benchmarks. */
export const STREAMING_FIXTURE_KINDS = ['fence', 'list', 'quote', 'table', 'paragraph'] as const;
export type StreamingFixtureKind = typeof STREAMING_FIXTURE_KINDS[number];
export function longStructure(kind: StreamingFixtureKind, size: number): string {
  const [prefix, row] = {
    fence: ['```ts\n', 'const x = "<&中😀>"; // growing code\n'],
    list: ['', '- item **bold** with [inline](https://example.org) and text\n'],
    quote: ['', '> Quoted plain words and 中文, another complete line\n'],
    table: ['| A | B |\n| :- | -: |\n', '| `cell` | [link](https://example.org) and **bold** |\n'],
    paragraph: ['**a long paragraph** ', 'words *em* and [link](https://example.org) 中文😀 '],
  }[kind];
  const remaining = Math.max(0, size - prefix.length);
  return prefix.slice(0, size) + row.repeat(Math.ceil(remaining / row.length)).slice(0, remaining);
}
