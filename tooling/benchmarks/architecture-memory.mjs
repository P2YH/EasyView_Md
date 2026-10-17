import path from 'node:path';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
const entry = process.argv.includes('--streaming') ? './streaming-markdown.ts' : './architecture-memory.ts';
const output = new URL('./.architecture-memory.mjs', import.meta.url);
try {
  await build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile: output.pathname, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'dependencies', setup(build) { build.onResolve({ filter: /^[^./]/ }, args => { if (!path.isAbsolute(args.path) && !args.path.startsWith('@easyview/')) return { path: args.path, external: true }; }); } }] });
  const result = spawnSync(process.execPath, [output.pathname], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { force: true }); }
